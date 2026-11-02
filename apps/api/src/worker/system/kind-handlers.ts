import type { Config } from '@eeasy-logistics/config';
import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { Logger } from '@nestjs/common';
import {
  deliveryConsumers,
  driverPushInvalidation,
  redisLatestForget,
} from '../../modules/delivery/public/index.js';
import { AuditWriter } from '../../modules/kernel/audit/audit-writer.js';
import { OutboxWriter } from '../../modules/kernel/outbox/outbox-writer.js';
import { Redis } from 'ioredis';
import { redisFeatureCache } from '../../modules/kernel/features/feature-resolver.js';
import { kernelConsumers } from '../../modules/kernel/outbox/account-suspended.consumer.js';
import { DomainEventConsumerRegistry } from '../../modules/kernel/outbox/domain-event-consumers.js';
import { messageKindHandlerFor } from './message-handler.js';
import { pushKindHandlerFor } from './push-handler.js';
import type { KindHandler } from '../../modules/kernel/outbox/kind-handlers.js';
import { StorageLifecycleHandler } from '../../modules/kernel/outbox/storage-lifecycle.handler.js';
import { PushTokenInvalidations } from '../../modules/kernel/push/invalidations.js';
import type { ObjectStorage } from '../../modules/kernel/storage/object-storage.js';
import { StubObjectStorage } from '../../modules/kernel/storage/object-storage.js';
import { InternalEventDispatcher } from './internal-events.js';

// The outbox kind handlers of this build (PLAT-8 plan 2.5, 2.6; PLAT-9; INT-4): `internal_event`
// (the kernel's consumers), `storage_lifecycle`, `message` and `push`. The relay enqueues only these
// kinds and the worker consumes only their queues. `webhook`, `channel_publish` and `carrier_call`
// have none yet (INT orders): their rows wait `pending`, counted.

/**
 * The object storage of `storage_lifecycle`: the stub in `local` and `ci`; elsewhere none until
 * OPS-1's adapter, so the kind has no handler there and its rows wait `pending` (counted by
 * `outbox_rows_without_handler`) instead of being marked deleted by a stub.
 */
export function objectStorageFor(config: Config): ObjectStorage | undefined {
  const env = config.app.env;
  return env === 'local' || env === 'ci' ? new StubObjectStorage(env) : undefined;
}

/**
 * `internal_event` needs the `elx_app` pool too (consumers run in a tenant unit of work, adversary
 * M-3): without `DATABASE_URL_APP` the kind has no handler and its rows wait `pending`.
 */
export function buildKindHandlers(
  config: Config,
  pool: Pool<PlatformDatabase>,
  app: Pool<AppDatabase> | undefined,
  logger: { warn(message: string): void } = new Logger('OutboxHandlers'),
): KindHandler[] {
  const handlers: KindHandler[] = [];
  if (app === undefined) {
    logger.warn('internal_event has no handler: DATABASE_URL_APP not configured');
  } else {
    // PLAT-13 plan 2.5: the feature cache bust deletes the gate's cached values after commit.
    const url = config.redis.url?.reveal();
    const redis =
      url === undefined
        ? null
        : new Redis(url, { connectTimeout: 2000, commandTimeout: 500, maxRetriesPerRequest: 1 });
    redis?.on('error', () => undefined);
    handlers.push(
      new InternalEventDispatcher({
        db: pool.db,
        app: app.db,
        consumers: new DomainEventConsumerRegistry([
          ...kernelConsumers({ featureCache: redis === null ? null : redisFeatureCache(redis) }),
          // DEL-5 plan 2.5: a suspended account's live shifts end by the system.
          ...deliveryConsumers({
            audit: new AuditWriter(),
            outbox: new OutboxWriter(),
            fanout: redis === null ? null : redisLatestForget(redis),
          }),
        ]),
        logger,
        close: () => {
          redis?.disconnect();
          return Promise.resolve();
        },
      }),
    );
  }
  const storage = objectStorageFor(config);
  if (storage === undefined) {
    logger.warn('storage_lifecycle has no handler: no object storage adapter before OPS-1');
  } else {
    handlers.push(new StorageLifecycleHandler(storage));
  }
  const message = messageKindHandlerFor(config, pool, logger);
  if (message !== undefined) handlers.push(message);
  // INT-4 plan 2.8: whenever this build has a push adapter (not with PUSH_DISABLED=true). DEL-4 plan
  // 2.11: an invalid token is cleared on its Delivery device row (needs the elx_app pool).
  const invalidations = new PushTokenInvalidations();
  if (app === undefined) {
    logger.warn('push token invalidations clear nothing: DATABASE_URL_APP not configured');
  } else {
    invalidations.register(driverPushInvalidation(app.db));
  }
  const push = pushKindHandlerFor(config, pool, logger, invalidations);
  if (push !== undefined) handlers.push(push);
  return handlers;
}
