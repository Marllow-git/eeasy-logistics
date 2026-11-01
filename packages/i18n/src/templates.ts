// The `messages` namespace (PLAT-9 plan 2.3; ADR-0037; integrations §5.1, §5.2): the text of every
// outbound message template in both locales, keyed by template key, so a provider's review comment
// changes one file. WhatsApp templates carry `body`, `footer` and `button`; mail templates carry
// `subject` and `body`. Parameters are `{name}` placeholders, filled from domain data only. A
// separate entry from `.` (like `./errors`): the API loads it through Node's own module loader,
// which needs the JSON import attribute; the web apps never load this namespace.
import arMessages from '../ar/messages.json' with { type: 'json' };
import enMessages from '../en/messages.json' with { type: 'json' };
import type { Locale } from './locales.ts';

export { isLocale, locales, type Locale } from './locales.ts';

// The Arabic catalogue is the reference shape: an English catalogue missing a key fails typecheck,
// and test/parity.test.ts fails on a key present in one locale only.
export type MessageTemplatesCatalogue = typeof arMessages;
export type MessageTemplateKey = keyof MessageTemplatesCatalogue;

export const messageTemplateTexts: Readonly<Record<Locale, MessageTemplatesCatalogue>> = {
  ar: arMessages,
  en: enMessages,
};

/** Every template key that has a text, in catalogue order. */
export const messageTemplateKeys = Object.keys(arMessages) as readonly MessageTemplateKey[];
