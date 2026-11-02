import { t as common } from '@eeasy-logistics/i18n';
import { appLocale, t } from '../../src/i18n';
import { Body, Screen, Title } from '../../src/ui/kit';

// The shell lands here until DRV-1 leg 2 adds the run, sync and cash tabs (plan 2.8).
export default function PlaceholderScreen() {
  return (
    <Screen>
      <Title>{t('app.name')}</Title>
      <Body testID="shell-placeholder">{common(appLocale(), 'placeholder.driver')}</Body>
    </Screen>
  );
}
