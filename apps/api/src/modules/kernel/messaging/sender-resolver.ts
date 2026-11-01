import type { MessagingStore } from '../platform/messaging.repository.js';
import type { EngineRoute } from './message-sender.js';
import type { SenderResolver } from './message.handler.js';

// Sender resolution (PLAT-9 plan 2A.3, 2A.4; ADR-0041 default 2): OTP and the platform's own rows
// (no account) leave through the platform instance; an account's message leaves only through the
// account's own linked instance, under the account's engine id from our mapping (allocated at first
// use, never from a request). An account without a linked sender gets `no_sender`: its message is
// skipped and the platform instance is never used for it, so a merchant's traffic can never put
// the OTP number at risk.

export function accountSenderResolver(
  store: MessagingStore,
  platformRoute: EngineRoute | null,
): SenderResolver {
  return {
    async resolve(accountId, template) {
      if (template === 'auth_otp' || accountId === null) return platformRoute ?? 'no_sender';
      return store.run(async (repo) => {
        const sender = await repo.senderOf(accountId);
        if (sender === undefined) return 'no_sender';
        const engineAccountId = await repo.engineAccountIdOf(accountId);
        if (engineAccountId === undefined) return 'no_sender';
        return { engineAccountId, senderInstanceId: sender.senderInstanceId };
      });
    },
  };
}
