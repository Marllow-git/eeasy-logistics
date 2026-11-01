import { hkdfSync } from 'node:crypto';
import type { Config } from '@eeasy-logistics/config';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { Redis } from 'ioredis';
import {
  memoryBreakerStateStore,
  redisBreakerStateStore,
} from '../../modules/kernel/messaging/breaker.js';
import { redisCapCounter } from '../../modules/kernel/messaging/message-policies.js';
import { MessageKindHandler } from '../../modules/kernel/messaging/message.handler.js';
import { OptOutList } from '../../modules/kernel/messaging/opt-out-list.js';
import { accountSenderResolver } from '../../modules/kernel/messaging/sender-resolver.js';
import { createMessageSenders } from '../../modules/kernel/messaging/senders.js';
import { messagingStore } from '../../modules/kernel/platform/messaging.repository.js';

// The worker's `message` handler (PLAT-9 plan 2.5, 2A.1): the adapters of this build behind breakers
// whose open state is shared through Redis (the API's OTP door reads it), the credentials cipher for
// secret parameters, and the sender resolver. No handler when this build has no adapter at all: the
// rows then wait `pending`, counted by `outbox_rows_without_handler`.

/** HKDF-SHA256 of the active credentials key, info `elx-msgcap`: the caps' phone pseudonyms. */
export function capPseudonymKey(base64Material: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(base64Material, 'base64'), Buffer.alloc(0), 'elx-msgcap', 32),
  );
}

export interface HandlerLogger {
  warn(message: string): void;
  log?(message: string): void;
}

export function messageKindHandlerFor(
  config: Config,
  pool: Pool<PlatformDatabase>,
  logger: HandlerLogger,
): MessageKindHandler | undefined {
  const url = config.redis.url?.reveal();
  const redis =
    url === undefined
      ? null
      : new Redis(url, { connectTimeout: 2000, commandTimeout: 500, maxRetriesPerRequest: 1 });
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
  const store = messagingStore(pool.db);
  const credentials = config.credentials;
  const activeKey = credentials?.keys[credentials.activeKeyId]?.reveal();
  if (redis === null || activeKey === undefined) {
    logger.warn('message caps off: they need REDIS_URL and the credentials keys');
  }
  return new MessageKindHandler({
    senders,
    cipher: credentials === null ? null : createCredentialsCipher(credentials),
    resolver: accountSenderResolver(store, senders.platformRoute),
    policies: {
      disabled: config.messaging.disabled,
      optOuts: new OptOutList(store),
      ...(redis === null || activeKey === undefined
        ? {}
        : { caps: { counter: redisCapCounter(redis), pseudonymKey: capPseudonymKey(activeKey) } }),
      budget: {
        sentThisMonth: (accountId) => store.run((repo) => repo.sentThisMonth(accountId)),
        countSent: (accountId) => store.run((repo) => repo.countSent(accountId)),
        // `messages_per_month` arrives with the provisioning door (PLAT-13): no limit until then.
        limitOf: () => Promise.resolve(undefined),
      },
    },
    logger: log,
    onClose: () => {
      redis?.disconnect();
      return Promise.resolve();
    },
  });
}
