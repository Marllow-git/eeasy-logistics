import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { getMetrics } from '../telemetry/metrics.js';
import type {
  MessageSender,
  SendTemplateInput,
  SentMessage,
  TemplateStatus,
} from './message-sender.js';

// The breaker per provider (PLAT-9 plan 2.1, 2.5; integrations §2.4 "Breaker and degraded"). The
// worker's adapter counts consecutive transient failures (network, timeout, 5xx); at the threshold
// it opens for `openMs`, refusing sends at once, then lets one trial through (half-open): success
// closes it, failure opens it again. Its open state is shared through Redis, so the API's OTP door
// can answer `503 messaging_unavailable` while it is open (the door never calls the provider).

/** Shared breaker state: written by the sending process, read by the OTP door. */
export interface BreakerStateStore {
  isOpen(name: string): Promise<boolean>;
  markOpen(name: string, openMs: number): Promise<void>;
  markClosed(name: string): Promise<void>;
}

export const breakerKeyPrefix = 'elx:breaker:messaging';

/** Redis keys `elx:breaker:messaging:<provider>`, present while open (expiring with the window). */
export function redisBreakerStateStore(
  redis: Pick<Redis, 'set' | 'del' | 'exists'>,
  prefix: string = breakerKeyPrefix,
): BreakerStateStore {
  return {
    async isOpen(name) {
      return (await redis.exists(`${prefix}:${name}`)) === 1;
    },
    async markOpen(name, openMs) {
      await redis.set(`${prefix}:${name}`, 'open', 'PX', openMs);
    },
    async markClosed(name) {
      await redis.del(`${prefix}:${name}`);
    },
  };
}

/** In-process state for unit tests and processes without Redis. */
export function memoryBreakerStateStore(now: () => number = Date.now): BreakerStateStore {
  const openUntil = new Map<string, number>();
  return {
    isOpen: (name) => Promise.resolve((openUntil.get(name) ?? 0) > now()),
    markOpen: (name, openMs) => {
      openUntil.set(name, now() + openMs);
      return Promise.resolve();
    },
    markClosed: (name) => {
      openUntil.delete(name);
      return Promise.resolve();
    },
  };
}

/** A send refused because the breaker is open; the handler waits without consuming an attempt. */
export class BreakerOpen extends Error {
  constructor(readonly provider: string) {
    super(`The ${provider} breaker is open`);
    this.name = 'BreakerOpen';
  }
}

export interface BreakerOptions {
  /** Consecutive transient failures that open the breaker. Default 5. */
  readonly threshold?: number;
  /** How long it stays open before one trial. Default 30 s. */
  readonly openMs?: number;
  readonly now?: () => number;
  readonly logger?: Pick<Logger, 'warn' | 'log'>;
}

type State =
  { kind: 'closed'; failures: number } | { kind: 'open'; until: number } | { kind: 'trial' };

/** Wraps an adapter with a breaker; the port is unchanged for the caller. */
export class BreakerSender implements MessageSender {
  readonly channel: MessageSender['channel'];
  readonly provider: string;
  #state: State = { kind: 'closed', failures: 0 };
  readonly #threshold: number;
  readonly #openMs: number;
  readonly #now: () => number;
  readonly #logger: Pick<Logger, 'warn' | 'log'>;

  constructor(
    private readonly inner: MessageSender,
    private readonly store: BreakerStateStore,
    options: BreakerOptions = {},
  ) {
    this.channel = inner.channel;
    this.provider = inner.provider;
    this.#threshold = options.threshold ?? 5;
    this.#openMs = options.openMs ?? 30_000;
    this.#now = options.now ?? Date.now;
    this.#logger = options.logger ?? new Logger('MessagingBreaker');
    this.#gauge();
  }

  /** `integration_breaker_state` (0 closed, 1 half-open, 2 open; observability/alerts.yaml). */
  #gauge(): void {
    const value = { closed: 0, half_open: 1, open: 2 }[this.state];
    getMetrics().set('integration_breaker_state', value, {
      port: 'message_sender',
      provider: this.provider,
    });
  }

  /** `closed`, `open` or `half_open` (the metric `integration_breaker_state`, plan 2.10). */
  get state(): 'closed' | 'open' | 'half_open' {
    if (this.#state.kind === 'closed') return 'closed';
    if (this.#state.kind === 'trial') return 'half_open';
    return this.#state.until > this.#now() ? 'open' : 'half_open';
  }

  async sendTemplate(input: SendTemplateInput): Promise<SentMessage> {
    if (this.#state.kind === 'trial') throw new BreakerOpen(this.provider);
    if (this.#state.kind === 'open') {
      if (this.#state.until > this.#now()) throw new BreakerOpen(this.provider);
      this.#state = { kind: 'trial' };
      this.#gauge();
    }
    try {
      const sent = await this.inner.sendTemplate(input);
      await this.#succeeded();
      return sent;
    } catch (error) {
      await this.#failed(error);
      throw error;
    }
  }

  listTemplates(): Promise<readonly TemplateStatus[]> {
    return this.inner.listTemplates();
  }

  async #succeeded(): Promise<void> {
    const wasOpen = this.#state.kind !== 'closed';
    this.#state = { kind: 'closed', failures: 0 };
    if (wasOpen) {
      this.#gauge();
      this.#logger.log(`messaging breaker closed provider=${this.provider}`);
      await this.#publish(() => this.store.markClosed(this.provider));
    }
  }

  async #failed(error: unknown): Promise<void> {
    // Outages count, and so do refused credentials (adversary M-3): a sender whose key or secret is
    // wrong cannot send anything, so the OTP door should answer 503 rather than take requests. A
    // rate limit or a refused request is the provider answering; the outbox handles those.
    const outage =
      !(error instanceof ProviderFailure) ||
      error.reason === 'transient' ||
      error.reason === 'unauthorised';
    if (!outage) {
      if (this.#state.kind === 'trial') await this.#succeeded();
      return;
    }
    const failures = this.#state.kind === 'closed' ? this.#state.failures + 1 : this.#threshold;
    if (failures < this.#threshold) {
      this.#state = { kind: 'closed', failures };
      return;
    }
    this.#state = { kind: 'open', until: this.#now() + this.#openMs };
    this.#gauge();
    this.#logger.warn(`messaging breaker open provider=${this.provider} for_ms=${this.#openMs}`);
    await this.#publish(() => this.store.markOpen(this.provider, this.#openMs));
  }

  /** The shared state is advisory: a Redis failure never fails the send's own outcome. */
  async #publish(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch {
      this.#logger.warn(`messaging breaker state not shared provider=${this.provider}`);
    }
  }
}
