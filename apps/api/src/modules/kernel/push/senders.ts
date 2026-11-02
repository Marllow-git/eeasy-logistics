import type { Config } from '@eeasy-logistics/config';
import { ExpoPushSender } from './expo-push-sender.js';
import type { PushSender } from './push-sender.js';
import { RecorderPushSender } from './recorder-push-sender.js';

// The push adapter of this build (INT-4 plan 2.2, 2.6, 2.8): `expo` with `EXPO_PUSH_URL` and the
// access token, or the in-memory recorder (`stub`), which only `local` and `ci` may run. None when
// push is disabled or no provider is set, or for the recorder elsewhere: the worker then registers
// no `push` handler and the rows wait `pending`, counted by `outbox_rows_without_handler`.

export type PushSenderChoice =
  { readonly sender: PushSender } | { readonly sender: undefined; readonly reason: string };

export function createPushSender(config: Config): PushSenderChoice {
  const push = config.push;
  if (push.disabled) return { sender: undefined, reason: 'PUSH_DISABLED=true' };
  if (push.provider === null) return { sender: undefined, reason: 'no PUSH_PROVIDER' };
  if (push.provider === 'stub') {
    const env = config.app.env;
    return env === 'local' || env === 'ci'
      ? { sender: new RecorderPushSender() }
      : { sender: undefined, reason: `the push recorder does not run in ${env}` };
  }
  return {
    sender: new ExpoPushSender({ baseUrl: push.expoPushUrl, accessToken: push.expoAccessToken }),
  };
}
