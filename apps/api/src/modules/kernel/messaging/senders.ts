import type { Config } from '@eeasy-logistics/config';
import { Logger } from '@nestjs/common';
import type { BreakerOptions, BreakerStateStore } from './breaker.js';
import { BreakerSender } from './breaker.js';
import { EngineMessageSender } from './engine/engine-message-sender.js';
import { MailSender } from './mail-sender.js';
import type { EngineRoute, MessageSender } from './message-sender.js';
import { MessageSenders, platformEngineAccountId } from './message-sender.js';

// Which adapters this build has (PLAT-9 plan 2.1, 2.2, 2A.1; ADR-0041): WhatsApp through the Eeasy
// WhatsApp engine's signed internal API, against the engine (`MESSAGING_PROVIDER=engine`) or the
// stub that speaks the same API (`stub`, local and ci); mail over SMTP. Every adapter sits behind
// its own breaker.

export interface SenderDependencies {
  readonly breakerStore: BreakerStateStore;
  readonly breaker?: BreakerOptions;
  readonly logger?: Pick<Logger, 'warn' | 'log'>;
}

/** The engine adapter of the configured provider, or null (with the reason) when it cannot exist. */
function engineSender(
  config: Config,
): { sender: EngineMessageSender; route: EngineRoute } | { missing: string } {
  const { provider, stubUrl, engine } = config.messaging;
  if (provider === null) return { missing: 'no MESSAGING_PROVIDER' };
  const baseUrl = provider === 'stub' ? stubUrl : engine.url?.reveal();
  const { serviceId, keyId, commandSecret, platformInstanceId } = engine;
  if (
    baseUrl === undefined ||
    serviceId === undefined ||
    keyId === undefined ||
    commandSecret === undefined ||
    platformInstanceId === undefined
  ) {
    return {
      missing:
        provider === 'stub'
          ? 'MESSAGING_STUB_URL or a WHATSAPP_ENGINE_* signing variable is not set'
          : 'a WHATSAPP_ENGINE_* variable is not set',
    };
  }
  // Throws outside local and ci for the stub, so a process configured with it there does not start.
  const sender = new EngineMessageSender({
    provider,
    appEnv: config.app.env,
    baseUrl,
    key: { service: serviceId.reveal(), keyId: keyId.reveal(), secret: commandSecret.reveal() },
  });
  return {
    sender,
    route: { engineAccountId: platformEngineAccountId, senderInstanceId: platformInstanceId },
  };
}

export function createMessageSenders(config: Config, deps: SenderDependencies): MessageSenders {
  const logger = deps.logger ?? new Logger('Messaging');
  const guard = (sender: MessageSender) =>
    new BreakerSender(sender, deps.breakerStore, { logger, ...deps.breaker });

  let whatsapp: MessageSender | null = null;
  let platformRoute: EngineRoute | null = null;
  const built = engineSender(config);
  if ('missing' in built) {
    logger.warn(`WhatsApp messages cannot be sent: ${built.missing}`);
  } else {
    whatsapp = guard(built.sender);
    platformRoute = built.route;
  }

  let mail: MessageSender | null = null;
  const { smtpUrl, from } = config.mail;
  if (smtpUrl !== undefined && from !== undefined) {
    mail = guard(new MailSender({ appEnv: config.app.env, smtpUrl: smtpUrl.reveal(), from }));
  }
  return new MessageSenders({ whatsapp, mail, platformRoute });
}
