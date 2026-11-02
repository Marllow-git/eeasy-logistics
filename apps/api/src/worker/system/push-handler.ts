import type { Config } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { pushTicketWriter } from '../../modules/kernel/platform/push-tickets.repository.js';
import { PushTokenInvalidations } from '../../modules/kernel/push/invalidations.js';
import { PushKindHandler } from '../../modules/kernel/push/push.handler.js';
import { createPushSender } from '../../modules/kernel/push/senders.js';

// The worker's `push` handler (INT-4 plan 2.3, 2.8): the adapter of this build, the ticket writer on
// the platform pool and the token invalidation registry, which the receipts job shares through the
// handler. No handler when push is disabled or no adapter exists here: the rows then wait
// `pending`, counted by `outbox_rows_without_handler`.

export function pushKindHandlerFor(
  config: Config,
  pool: Pool<PlatformDatabase>,
  logger: { warn(message: string): void },
  invalidations: PushTokenInvalidations = new PushTokenInvalidations(),
): PushKindHandler | undefined {
  const choice = createPushSender(config);
  if (choice.sender === undefined) {
    logger.warn(`push has no handler: ${choice.reason}`);
    return undefined;
  }
  return new PushKindHandler({
    sender: choice.sender,
    tickets: pushTicketWriter(pool.db),
    invalidations,
  });
}
