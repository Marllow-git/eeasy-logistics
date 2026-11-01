import type { Locale } from '@eeasy-logistics/i18n';
import arPlatform from '../../messages/ar/platform.json';
import enPlatform from '../../messages/en/platform.json';

// The `platform` namespace (ADR-0038): only this app loads it, so the merchant build carries no
// platform string. The Arabic file is the reference shape, as for the shared catalogues; an English
// file missing a key fails typecheck here, and packages/i18n's parity test checks both directions.
export const appMessages = {
  ar: { platform: arPlatform },
  en: { platform: enPlatform satisfies typeof arPlatform },
} satisfies Record<Locale, { platform: typeof arPlatform }>;

declare module '@eeasy-logistics/ui/intl' {
  interface AppMessages {
    platform: typeof arPlatform;
  }
}
