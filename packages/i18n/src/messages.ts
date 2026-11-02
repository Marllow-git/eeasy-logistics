import arAuth from '../ar/auth.json';
import arCommon from '../ar/common.json';
import arErrors from '../ar/errors.json';
import arNav from '../ar/nav.json';
import arRecipient from '../ar/recipient.json';
import arSettings from '../ar/settings.json';
import enAuth from '../en/auth.json';
import enCommon from '../en/common.json';
import enErrors from '../en/errors.json';
import enNav from '../en/nav.json';
import enRecipient from '../en/recipient.json';
import enSettings from '../en/settings.json';
import type { Locale } from './locales.ts';

// The Arabic catalogue is the reference shape (web §5): `Messages` is generated from it, so an
// English catalogue missing a key fails typecheck here, and a component asking next-intl for a key
// the Arabic catalogue lacks fails typecheck through the AppConfig augmentation in packages/ui
// (src/intl.ts; kept there so the driver app needs no next-intl). The `errors` namespace is
// PLAT-6's `{ codes, fields }` catalogue, also served to the API through `./errors`. The `platform`
// namespace is not here: it lives in apps/admin/messages (ADR-0038), so apps/web cannot load it.
// test/parity.test.ts additionally fails on a key present in one locale only, in either direction.
const ar = {
  common: arCommon,
  nav: arNav,
  auth: arAuth,
  errors: arErrors,
  recipient: arRecipient,
  settings: arSettings,
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
    settings: enSettings,
  },
};

/** The namespaces a client provider receives, so a group ships only the strings it renders. */
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
