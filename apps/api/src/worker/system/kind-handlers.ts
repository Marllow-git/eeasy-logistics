import type { Config } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import type { KindHandler } from '../../modules/kernel/outbox/kind-handlers.js';

// The outbox kind handlers of this build (PLAT-8 plan 2.5): the relay enqueues only these kinds
// and the worker consumes only their queues. `webhook`, `message`, `push`, `channel_publish` and
// `carrier_call` have none yet (PLAT-9, INT orders): their rows wait `pending`, counted.

export function buildKindHandlers(_config: Config, _pool: Pool<PlatformDatabase>): KindHandler[] {
  return [];
}
