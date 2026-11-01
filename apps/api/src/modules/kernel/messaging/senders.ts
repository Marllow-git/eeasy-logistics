import type { Config } from '@eeasy-logistics/config';
import { Logger } from '@nestjs/common';
import type { BreakerOptions, BreakerStateStore } from './breaker.js';
import { BreakerSender } from './breaker.js';
import { MailSender } from './mail-sender.js';
import type { MessageSender } from './message-sender.js';
import { MessageSenders } from './message-sender.js';
import { StubMessageSender } from './stub-message-sender.js';

// Which adapters this build has (PLAT-9 plan 2.1, 2.2, amended by owner input 2026-11-01): the
// WhatsApp stub (local and ci) and SMTP mail. `MESSAGING_PROVIDER=meta|bsp` is accepted by the
// configuration, but its adapter (eeasynew's `whatsapp-engine`) arrives in leg 2 under the amended
// plan, so until then that channel has no sender. Every adapter sits behind its own breaker.

export interface SenderDependencies {
  readonly breakerStore: BreakerStateStore;
  readonly breaker?: BreakerOptions;
  readonly logger?: Pick<Logger, 'warn' | 'log'>;
}

export function createMessageSenders(config: Config, deps: SenderDependencies): MessageSenders {
  const logger = deps.logger ?? new Logger('Messaging');
  const guard = (sender: MessageSender) =>
    new BreakerSender(sender, deps.breakerStore, { logger, ...deps.breaker });

  let whatsapp: MessageSender | null = null;
  const { provider, stubUrl, templateNamespace } = config.messaging;
  if (provider === 'stub') {
    if (stubUrl === undefined) {
      logger.warn('MESSAGING_STUB_URL is not set: WhatsApp messages cannot be sent');
    } else {
      // Throws outside local and ci, so a process configured with the stub there does not start.
      whatsapp = guard(
        new StubMessageSender({ appEnv: config.app.env, url: stubUrl, templateNamespace }),
      );
    }
  } else if (provider !== null) {
    logger.warn(
      `MESSAGING_PROVIDER=${provider} has no adapter in this build: WhatsApp messages cannot be sent`,
    );
  }

  let mail: MessageSender | null = null;
  const { smtpUrl, from } = config.mail;
  if (smtpUrl !== undefined && from !== undefined) {
    mail = guard(new MailSender({ appEnv: config.app.env, smtpUrl: smtpUrl.reveal(), from }));
  }
  return new MessageSenders({ whatsapp, mail });
}
