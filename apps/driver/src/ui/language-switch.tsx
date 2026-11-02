import { appLocale, changeLocale, t } from '../i18n';
import { track } from '../observability';
import { Button } from './kit';

/** Switches between Arabic and English; the app persists the choice and reloads (driver app §10). */
export function LanguageSwitch() {
  const next = appLocale() === 'ar' ? 'en' : 'ar';
  return (
    <Button
      testID="language-switch"
      variant="link"
      label={t('language.switch')}
      accessibilityHint={t('language.switch_hint')}
      onPress={() => {
        track('language_changed', { locale: next });
        void changeLocale(next);
      }}
    />
  );
}
