import { Logger } from '@nestjs/common';

// Push token invalidation (INT-4 plan 2.5; integrations §2.5 "Token invalidation"): a ticket or
// receipt `DeviceNotRegistered` means the token no longer reaches the device. The token lives on the
// Delivery device row (`del_driver_devices.push_token`, DEL-4), which the kernel never reads or
// writes; so the kernel keeps a registry of handlers and Delivery (DEL-4) registers the one that
// clears the token in a Delivery transaction. Until then nothing clears a token: the log line and
// the counter record each invalidation.

export type PushTokenInvalidationReason = 'device_not_registered';

export interface PushTokenInvalidation {
  readonly accountId: string;
  /** The Delivery device id the push went to (never the token itself). */
  readonly deviceId: string;
  readonly reason: PushTokenInvalidationReason;
}

export type PushTokenInvalidationHandler = (invalidation: PushTokenInvalidation) => Promise<void>;

/**
 * The handlers that act on an invalid token. `invalidate` runs every registered handler once; a
 * failing handler is logged (its error name only) and does not stop the others or the caller:
 * the push itself already happened, and the next `DeviceNotRegistered` will ask again.
 */
export class PushTokenInvalidations {
  readonly #handlers: PushTokenInvalidationHandler[] = [];
  readonly #logger: Pick<Logger, 'log' | 'warn'>;

  constructor(logger: Pick<Logger, 'log' | 'warn'> = new Logger('PushTokenInvalidations')) {
    this.#logger = logger;
  }

  /** Adds a handler (DEL-4: clear `push_token` on the device row). */
  register(handler: PushTokenInvalidationHandler): void {
    this.#handlers.push(handler);
  }

  /** The number of handlers registered. */
  get size(): number {
    return this.#handlers.length;
  }

  /** Runs every handler for one device; returns how many succeeded. */
  async invalidate(invalidation: PushTokenInvalidation): Promise<number> {
    this.#logger.log(
      `push token invalidated device_id=${invalidation.deviceId} reason=${invalidation.reason} ` +
        `handlers=${this.#handlers.length}`,
    );
    let succeeded = 0;
    for (const handler of this.#handlers) {
      try {
        await handler(invalidation);
        succeeded += 1;
      } catch (error) {
        this.#logger.warn(
          `push token invalidation handler failed device_id=${invalidation.deviceId}: ` +
            `${error instanceof Error ? error.name : 'unknown error'}`,
        );
      }
    }
    return succeeded;
  }
}
