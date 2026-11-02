import type { DriverRefreshRequest, TokenPair } from '@eeasy-logistics/contracts/driver';
import { ApiError } from '@eeasy-logistics/contracts/http';
import { secretKeys, type SecretStore } from '../platform/secure-store';
import type { RefreshLease } from './refresh-lease';
import { leaseMilliseconds } from './refresh-lease';

// The driver session (driver app §7.2 to §7.4, DRV-1 plan 2.4): the refresh token and the driver id
// in the secure store, the access token in memory only. Refresh is single-flight twice over: one
// promise per JS context, and the SQLite lease across contexts, read under which the refresh token
// is always the latest one written. The session tells the UI what happened through its state:
// ended (with the reason), suspended (read-only), or an update required.

/** Why a session ended: the driver signed out, a dispatcher removed the device, or the family died. */
export type EndReason = 'signed_out' | 'device_revoked' | 'token_invalid';

export interface SessionState {
  /** False until the secure store was read once at start. */
  readonly hydrated: boolean;
  readonly signedIn: boolean;
  /** `403 account_suspended`: the session stays, read-only, behind a banner (§7.3). */
  readonly suspended: boolean;
  /** `426 app_update_required` on any door. */
  readonly updateRequired: boolean;
  readonly endReason: EndReason | undefined;
  readonly driverId: string | undefined;
}

export interface SessionDeps {
  readonly secrets: SecretStore;
  readonly lease: RefreshLease;
  /** `driverRefresh`; throws `ApiError` on a non-2xx answer. */
  readonly refresh: (body: DriverRefreshRequest) => Promise<TokenPair>;
  /** This JS context's lease holder name (a random id per context). */
  readonly holder: string;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Run when a session ends, before the state says so (ADR-0034: the verifier is deleted). */
  readonly onEnded?: (reason: EndReason) => Promise<void>;
}

/** Refresh this long before `expires_in` runs out while the app is in front (§7.2). */
export const refreshAheadMilliseconds = 60_000;
const leasePollMilliseconds = 200;

export class SessionEndedError extends Error {
  override readonly name = 'SessionEndedError';
  constructor(readonly reason: EndReason) {
    super(`The session ended: ${reason}`);
  }
}

export class Session {
  private state: SessionState = {
    hydrated: false,
    signedIn: false,
    suspended: false,
    updateRequired: false,
    endReason: undefined,
    driverId: undefined,
  };
  private readonly listeners = new Set<() => void>();
  private accessToken: string | undefined;
  private expiresAt = 0;
  private inflight: Promise<string> | undefined;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly deps: SessionDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep =
      deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Reads the secure store once: a stored refresh token means a session (the access token follows). */
  async hydrate(): Promise<void> {
    const [refreshToken, driverId] = await Promise.all([
      this.deps.secrets.get(secretKeys.refreshToken),
      this.deps.secrets.get(secretKeys.driverId),
    ]);
    this.update({
      hydrated: true,
      signedIn: refreshToken !== null,
      driverId: driverId ?? undefined,
    });
  }

  /** Starts a session from `driverVerifyOtp`'s answer. */
  async begin(tokens: TokenPair, driverId: string, accountId: string | undefined): Promise<void> {
    await this.deps.secrets.set(secretKeys.refreshToken, tokens.refresh_token);
    await this.deps.secrets.set(secretKeys.driverId, driverId);
    if (accountId !== undefined) await this.deps.secrets.set(secretKeys.accountId, accountId);
    this.keepAccess(tokens);
    this.update({
      hydrated: true,
      signedIn: true,
      suspended: false,
      endReason: undefined,
      driverId,
    });
  }

  /** A usable access token, refreshed first when it is missing or about to expire. */
  async getAccessToken(): Promise<string | undefined> {
    if (!this.state.signedIn) return undefined;
    if (this.accessToken !== undefined && this.expiresAt - this.now() > refreshAheadMilliseconds) {
      return this.accessToken;
    }
    return this.refresh();
  }

  /** Rotates the refresh token; concurrent callers in this context share one call. */
  refresh(): Promise<string> {
    this.inflight ??= this.refreshUnderLease().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Ends the session and clears what §7.4 says for this order: tokens, ids, the verifier. */
  async end(reason: EndReason): Promise<void> {
    this.accessToken = undefined;
    this.expiresAt = 0;
    await Promise.all([
      this.deps.secrets.delete(secretKeys.refreshToken),
      this.deps.secrets.delete(secretKeys.driverId),
      this.deps.secrets.delete(secretKeys.accountId),
    ]);
    await this.deps.onEnded?.(reason);
    this.update({ signedIn: false, suspended: false, endReason: reason, driverId: undefined });
  }

  markSuspended(): void {
    if (!this.state.suspended) this.update({ suspended: true });
  }

  markUpdateRequired(): void {
    if (!this.state.updateRequired) this.update({ updateRequired: true });
  }

  private async refreshUnderLease(): Promise<string> {
    const { lease, holder, secrets } = this.deps;
    const deadline = this.now() + leaseMilliseconds + leasePollMilliseconds;
    while (!lease.tryAcquire(holder, this.now())) {
      if (this.now() > deadline) throw new Error('The refresh lease stayed busy.');
      await this.sleep(leasePollMilliseconds);
    }
    try {
      // Read under the lease: another context may have rotated the token while this one waited.
      const [refreshToken, deviceId] = await Promise.all([
        secrets.get(secretKeys.refreshToken),
        secrets.get(secretKeys.deviceId),
      ]);
      if (refreshToken === null || deviceId === null) {
        await this.end('token_invalid');
        throw new SessionEndedError('token_invalid');
      }
      let tokens: TokenPair;
      try {
        tokens = await this.deps.refresh({ refresh_token: refreshToken, device_id: deviceId });
      } catch (error) {
        await this.onRefreshError(error);
        throw error;
      }
      await secrets.set(secretKeys.refreshToken, tokens.refresh_token);
      this.keepAccess(tokens);
      if (this.state.suspended) this.update({ suspended: false });
      return tokens.access_token;
    } finally {
      lease.release(holder);
    }
  }

  private async onRefreshError(error: unknown): Promise<void> {
    if (!(error instanceof ApiError)) return; // offline: keep the session and try again later
    if (error.status === 401) {
      // device_revoked, token_invalid, or an expired refresh token: all end the session (§7.3).
      await this.end(error.code === 'device_revoked' ? 'device_revoked' : 'token_invalid');
    } else if (error.code === 'account_suspended') {
      this.markSuspended();
    } else if (error.code === 'app_update_required') {
      this.markUpdateRequired();
    }
  }

  private keepAccess(tokens: TokenPair): void {
    this.accessToken = tokens.access_token;
    this.expiresAt = this.now() + tokens.expires_in * 1000;
  }

  private update(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
