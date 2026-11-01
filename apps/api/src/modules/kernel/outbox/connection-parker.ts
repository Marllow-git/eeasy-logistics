import type { OutboxRow } from './kind-handlers.js';
import type { ProviderFailure } from './provider-failure.js';

/** How long a row of a parked connection waits before it is tried again (plan 2.5). */
export const parkedRetryS = 60 * 60;

/**
 * What the outbox does with an `unauthorised` failure (ADR-0036; integrations §4.2, §8): mark the
 * connection `needs_reauth` and park its rows without consuming attempts. The channel and carrier
 * orders implement it; until then the stub only logs, and the row is retried in an hour.
 */
export interface ConnectionParker {
  park(row: OutboxRow, failure: ProviderFailure): Promise<void>;
}

/** The PLAT-8 stub: logs the parked row (ids and kind only, never the payload). */
export class LoggingConnectionParker implements ConnectionParker {
  constructor(private readonly logger: { warn(message: string): void }) {}

  park(row: OutboxRow, failure: ProviderFailure): Promise<void> {
    this.logger.warn(
      `Outbox row ${row.id} (${row.kind}) unauthorised` +
        `${failure.connectionId === undefined ? '' : ` on connection ${failure.connectionId}`}: ` +
        `retried in ${parkedRetryS} s; no connection parking before the channel and carrier orders`,
    );
    return Promise.resolve();
  }
}
