// How an adapter reports a failed provider call to the outbox (PLAT-8 plan 2.5; ADR-0036;
// integrations §4.2): the kind decides the retry, never the handler's guesswork.

export type ProviderFailureReason =
  /** The provider asked us to slow down: retry at `retryAfterS`, no attempt consumed. */
  | 'rate_limited'
  /** A revoked token: the connection is parked (`ConnectionParker`), no attempt consumed. */
  | 'unauthorised'
  /** A request the provider will never accept (a 4xx validation error): dead at once. */
  | 'permanent'
  /** Anything else worth retrying (network, 5xx): consumes an attempt. */
  | 'transient';

export interface ProviderFailureDetails {
  /** The provider's status code, stored in `last_error`. */
  readonly status?: number | string;
  readonly retryAfterS?: number;
  /** The channel or carrier connection a revoked token belongs to. */
  readonly connectionId?: string;
}

/** Thrown by an adapter (or a handler) for a provider call that failed. */
export class ProviderFailure extends Error {
  readonly status: number | string | undefined;
  readonly retryAfterS: number | undefined;
  readonly connectionId: string | undefined;

  constructor(
    readonly reason: ProviderFailureReason,
    message: string,
    details: ProviderFailureDetails = {},
  ) {
    super(message);
    this.name = 'ProviderFailure';
    this.status = details.status;
    this.retryAfterS = details.retryAfterS;
    this.connectionId = details.connectionId;
  }
}
