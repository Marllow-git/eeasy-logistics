import type { Config } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { Logger } from '@nestjs/common';
import { AuditWriter } from '../../modules/kernel/audit/audit-writer.js';
import type { KindHandler } from '../../modules/kernel/outbox/kind-handlers.js';
import { StorageLifecycleHandler } from '../../modules/kernel/outbox/storage-lifecycle.handler.js';
import type { ObjectStorage } from '../../modules/kernel/storage/object-storage.js';
import { StubObjectStorage } from '../../modules/kernel/storage/object-storage.js';

// The outbox kind handlers of this build (PLAT-8 plan 2.5): the relay enqueues only these kinds
// and the worker consumes only their queues. `webhook`, `message`, `push`, `channel_publish` and
// `carrier_call` have none yet (PLAT-9, INT orders): their rows wait `pending`, counted.

/**
 * The object storage of `storage_lifecycle`: the stub in `local` and `ci`; elsewhere none until
 * OPS-1's adapter, so the kind has no handler there and its rows wait `pending` (counted by
 * `outbox_rows_without_handler`) instead of being marked deleted by a stub.
 */
export function objectStorageFor(config: Config): ObjectStorage | undefined {
  const env = config.app.env;
  return env === 'local' || env === 'ci' ? new StubObjectStorage(env) : undefined;
}

export function buildKindHandlers(
  config: Config,
  pool: Pool<PlatformDatabase>,
  logger: { warn(message: string): void } = new Logger('OutboxHandlers'),
): KindHandler[] {
  const handlers: KindHandler[] = [];
  const storage = objectStorageFor(config);
  if (storage === undefined) {
    logger.warn('storage_lifecycle has no handler: no object storage adapter before OPS-1');
  } else {
    handlers.push(new StorageLifecycleHandler(storage, new AuditWriter(pool)));
  }
  return handlers;
}
