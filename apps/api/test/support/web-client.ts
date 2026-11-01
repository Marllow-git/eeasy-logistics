// The web client marker of a staff or platform write (PLAT-6 plan 2.11): what the merchant web and
// the platform console send, for tests that exercise writes on those surfaces.
import type { Config } from '@eeasy-logistics/config';
import { originOf } from '../../src/modules/kernel/request/web-client.guard.js';

export function webClientHeaders(
  config: Config,
  surface: 'staff' | 'platform',
): Record<string, string> {
  const url = surface === 'staff' ? config.app.publicWebUrl : config.app.publicAdminUrl;
  const origin = originOf(url);
  if (origin === undefined) {
    throw new Error(
      `Set ${surface === 'staff' ? 'PUBLIC_WEB_URL' : 'PUBLIC_ADMIN_URL'} for this test`,
    );
  }
  return { 'X-EL-Client': 'web', Origin: origin };
}
