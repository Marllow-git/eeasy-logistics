import type { Config } from '@eeasy-logistics/config';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { Redis } from 'ioredis';
import {
  memoryBreakerStateStore,
  redisBreakerStateStore,
} from '../../modules/kernel/messaging/breaker.js';
import {
  MessageKindHandler,
  platformOnlyResolver,
} from '../../modules/kernel/messaging/message.handler.js';
import { createMessageSenders } from '../../modules/kernel/messaging/senders.js';

// The worker's `message` handler (PLAT-9 plan 2.5, 2A.1): the adapters of this build behind breakers
// whose open state is shared through Redis (the API's OTP door reads it), the credentials cipher for
// secret parameters, and the sender resolver. No handler when this build has no adapter at all: the
// rows then wait `pending`, counted by `outbox_rows_without_handler`.

export interface HandlerLogger {
  warn(message: string): void;
  log?(message: string): void;
}

export function messageKindHandlerFor(
  config: Config,
  pool: Pool<PlatformDatabase>,
  logger: HandlerLogger,
): MessageKindHandler | undefined {
  void pool;
  const url = config.redis.url?.reveal();
  const redis =
    url === undefined
      ? null
      : new Redis(url, {
          lazyConnect: true,
          connectTimeout: 2000,
          commandTimeout: 500,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
  redis?.on('error', () => undefined);
  const log = { warn: (m: string) => logger.warn(m), log: (m: string) => logger.log?.(m) };
  const senders = createMessageSenders(config, {
    breakerStore: redis === null ? memoryBreakerStateStore() : redisBreakerStateStore(redis),
    logger: log,
  });
  const has = (channel: 'whatsapp' | 'mail') => {
    try {
      senders.senderFor(null, channel);
      return true;
    } catch {
      return false;
    }
  };
  if (!has('whatsapp') && !has('mail')) {
    logger.warn('message has no handler: no WhatsApp or mail sender is configured');
    redis?.disconnect();
    return undefined;
  }
  return new MessageKindHandler({
    senders,
    cipher: config.credentials === null ? null : createCredentialsCipher(config.credentials),
    resolver: platformOnlyResolver(senders),
    logger: log,
    onClose: () => {
      redis?.disconnect();
      return Promise.resolve();
    },
  });
}
