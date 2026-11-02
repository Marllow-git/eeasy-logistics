// The `PushSender` port (INT-4 plan 2.1; integrations §2.5; ADR-0024): the `push` outbox handler and
// the receipts job are its only callers, and every failure is a `ProviderFailure` (`rate_limited`,
// `unauthorised`, `permanent`, `transient`) so the outbox decides the retry. Push is a hint
// (ADR-0009): the driver app also fetches offers and runs, so a lost push delays, never loses, work.

/** The Android notification channels of the driver app (driver app §8.2). */
export const pushChannels = ['offers', 'run', 'cash'] as const;
export type PushChannel = (typeof pushChannels)[number];

/** Messages per `send` call: the Expo push service takes at most 100 per request. */
export const maxPushBatch = 100;
/** Ticket ids per `receipts` call: the Expo push service takes at most 1,000 per request. */
export const maxReceiptIds = 1_000;

/** The ticket and receipt error that means the token no longer reaches the device. */
export const deviceNotRegistered = 'DeviceNotRegistered';

/** One notification to one device. Title and body are rendered by the server; `data` holds ids. */
export interface PushMessage {
  /** The Expo push token (`ExponentPushToken[…]`); personal data, never logged (data §10). */
  readonly to: string;
  readonly title: string;
  readonly body: string;
  /** Ids, the deep-link route and `push_id` (the outbox row id) only; strings throughout. */
  readonly data: Readonly<Record<string, string>>;
  /** How long the push service keeps trying to deliver it. */
  readonly ttlSeconds: number;
  /** A newer push with the same id replaces an undelivered one on the device. */
  readonly collapseId?: string;
  readonly channelId: PushChannel;
  readonly priority: 'high' | 'default';
  /** The device's default sound, or silent. */
  readonly sound: boolean;
}

/** The push service's answer per message, in the order of the request (`index`). */
export type PushTicket =
  | { readonly index: number; readonly status: 'ok'; readonly id: string }
  | { readonly index: number; readonly status: 'error'; readonly error: string };

/** The delivery result of a ticket, once the push service has one (within 15 minutes). */
export type PushReceipt =
  | { readonly id: string; readonly status: 'ok' }
  | { readonly id: string; readonly status: 'error'; readonly error: string };

/** What a call belongs to, for its span (never the payload). */
export interface PushCallContext {
  readonly accountId?: string | null;
  readonly outboxRowId?: string;
  /** The outbox attempt (1 for the first). */
  readonly attempt?: number;
}

export interface PushSender {
  /** `expo` or `stub`: the span's provider. */
  readonly provider: 'expo' | 'stub';
  /** Sends up to `maxPushBatch` messages in one request; one ticket per message, in order. */
  send(messages: readonly PushMessage[], call?: PushCallContext): Promise<PushTicket[]>;
  /**
   * The receipts of up to `maxReceiptIds` tickets. A ticket without a receipt yet (or any more,
   * after 24 hours) is absent from the answer.
   */
  receipts(ids: readonly string[]): Promise<PushReceipt[]>;
}

/** A provider error name fit for a row, a log or a metric label: letters only, else `unknown`. */
export function providerErrorName(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z_]{1,64}$/.test(value) ? value : 'unknown';
}
