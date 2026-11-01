import type { Locale, Messages } from '@eeasy-logistics/i18n';

/**
 * Namespaces an app adds to the shared catalogues and merges into its request config: apps/admin
 * declares `platform` (ADR-0038) with `declare module '@eeasy-logistics/ui/intl'`; apps/web adds
 * nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by module augmentation
export interface AppMessages {}

// Web §5: next-intl is typed from the Arabic catalogue, so `t('no_such_key')` and an unknown locale
// fail typecheck. The augmentation lives in this module (not a global .d.ts) so that every program
// that imports a component or the shell, the apps included, sees it; packages/i18n stays free of
// next-intl for the driver app.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages & AppMessages;
  }
}

export { useLocale, useTranslations } from 'next-intl';
