import arAuth from '../ar/auth.json';
import arCommon from '../ar/common.json';
import arErrors from '../ar/errors.json';
import arNav from '../ar/nav.json';
import arPlatform from '../ar/platform.json';
import arRecipient from '../ar/recipient.json';
import enAuth from '../en/auth.json';
import enCommon from '../en/common.json';
import enErrors from '../en/errors.json';
import enNav from '../en/nav.json';
import enPlatform from '../en/platform.json';
import enRecipient from '../en/recipient.json';
import type { Locale } from './locale';

// The Arabic catalogue is the reference shape (web §5): `Messages` is generated from it, so an
// English catalogue missing a key fails typecheck here, and a component asking next-intl for a key
// the Arabic catalogue lacks fails typecheck through the AppConfig augmentation in packages/ui
// (src/shell/next-intl.d.ts; kept there so the driver app needs no next-intl).
// test/parity.test.ts additionally fails on a key present in one locale only, in either direction.
const ar = {
  common: arCommon,
  nav: arNav,
  auth: arAuth,
  errors: arErrors,
  recipient: arRecipient,
  platform: arPlatform,
};

export type Messages = typeof ar;
export type Namespace = keyof Messages;

export const messages: Record<Locale, Messages> = {
  ar,
  en: {
    common: enCommon,
    nav: enNav,
    auth: enAuth,
    errors: enErrors,
    recipient: enRecipient,
    platform: enPlatform,
  },
};

/**
 * The namespaces a client provider receives, so a group ships only the strings it renders (the
 * merchant bundle never carries the `platform` namespace, ADR-0038).
 */
export function pickMessages<const N extends Namespace>(
  locale: Locale,
  namespaces: readonly N[],
): Pick<Messages, N> {
  const all = messages[locale];
  return Object.fromEntries(namespaces.map((namespace) => [namespace, all[namespace]])) as Pick<
    Messages,
    N
  >;
}
