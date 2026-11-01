import type { Locale, Messages } from '@eeasy-logistics/i18n';

// Web §5: next-intl is typed from the Arabic catalogue, so `t('no_such_key')` and an unknown locale
// fail typecheck. The augmentation lives in this module (not a global .d.ts) so that every program
// that imports a component or the shell, the apps included, sees it; packages/i18n stays free of
// next-intl for the driver app.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}

export { useLocale, useTranslations } from 'next-intl';
