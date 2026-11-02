import { useRouter } from 'expo-router';
import { useState } from 'react';
import { t } from '../../src/i18n';
import { track } from '../../src/observability';
import { driverApp } from '../../src/sync/driver-app';
import { pendingSignIn, verifyOtp } from '../../src/sync/sign-in';
import { verifyErrorMessage } from '../../src/ui/errors';
import { Banner, Body, Button, Screen, Title } from '../../src/ui/kit';

/**
 * The account picker (DRV-1 plan 2.5; DEL-4 plan 8.2 #37): the phone drives for several accounts, so
 * the same code goes again with the chosen `account_id` (the server did not spend it).
 */
export default function AccountPickerScreen() {
  const router = useRouter();
  const pending = pendingSignIn();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const choose = async (accountId: string) => {
    if (pending?.code === undefined) return;
    setBusy(accountId);
    setError(undefined);
    try {
      const result = await verifyOtp(pending.phone, pending.code, accountId);
      if (result.kind === 'signed_in') {
        track('driver_signed_in', {
          driver_id: result.session.driver?.id ?? '',
          account_id: accountId,
          device_id: await driverApp().deviceId(),
        });
      }
    } catch (caught) {
      setError(verifyErrorMessage(caught).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Screen
      footer={<Button variant="link" label={t('common.back')} onPress={() => router.back()} />}
    >
      <Title>{t('account.title')}</Title>
      <Body tone="muted">{t('account.subtitle')}</Body>
      {(pending?.accounts ?? []).map((account, index) => (
        <Button
          key={account.account_id}
          testID={`account-${index}`}
          variant="secondary"
          label={account.name}
          busy={busy === account.account_id}
          disabled={busy !== undefined}
          onPress={() => void choose(account.account_id)}
        />
      ))}
      {error === undefined ? null : (
        <Banner tone="danger" testID="account-error">
          {error}
        </Banner>
      )}
    </Screen>
  );
}
