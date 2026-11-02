import { t } from '../src/i18n';
import { Body, Screen, Title } from '../src/ui/kit';

/**
 * The full-screen update notice (DRV-1 plan 2.9): the API answered `426 app_update_required`. No
 * store link exists in wave 1, so the notice says to update from the store; it cannot be dismissed.
 */
export default function UpdateRequiredScreen() {
  return (
    <Screen>
      <Title>{t('update.title')}</Title>
      <Body testID="update-required-notice">{t('update.body')}</Body>
    </Screen>
  );
}
