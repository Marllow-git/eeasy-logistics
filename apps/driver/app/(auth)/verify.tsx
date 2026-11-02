import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { appLocale, isolate, t } from '../../src/i18n';
import { track } from '../../src/observability';
import { driverApp } from '../../src/sync/driver-app';
import { requestOtp, verifyOtp } from '../../src/sync/sign-in';
import { CodeInput } from '../../src/ui/code-input';
import { genericErrorMessage, verifyErrorMessage } from '../../src/ui/errors';
import { Banner, Body, Button, Screen, Small, Title } from '../../src/ui/kit';

const resendSeconds = 60;

/** Six-digit code (driver app §7.1, DRV-1 plan 2.5) and the device notices of DEL-4. */
export default function VerifyScreen() {
  const router = useRouter();
  const { phone = '' } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; codeWrong: boolean }>();
  const [seconds, setSeconds] = useState(resendSeconds);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const verify = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await verifyOtp(phone, code);
      if (result.kind === 'choose_account') {
        router.push('/account');
        return;
      }
      track('driver_signed_in', {
        driver_id: result.session.driver?.id ?? '',
        account_id: null,
        device_id: await driverApp().deviceId(),
      });
    } catch (caught) {
      setError(verifyErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(undefined);
    setCode('');
    try {
      await requestOtp(phone, appLocale());
      setSeconds(resendSeconds);
    } catch (caught) {
      setError({ message: genericErrorMessage(caught), codeWrong: false });
    }
  };

  return (
    <Screen
      footer={
        <>
          <Button
            testID="verify-code"
            label={t('verify.submit')}
            disabled={code.length !== 6}
            busy={busy}
            onPress={() => void verify()}
          />
          <Button variant="link" label={t('verify.change_number')} onPress={() => router.back()} />
        </>
      }
    >
      <Title>{t('verify.title')}</Title>
      <Banner tone="success">{t('sign_in.sent_generic')}</Banner>
      <Body tone="muted">{t('verify.sent_to', { phone: isolate(phone) })}</Body>
      <CodeInput
        testID="code-input"
        label={t('verify.code_label')}
        value={code}
        onChange={setCode}
        error={error?.codeWrong ?? false}
      />
      {error === undefined ? null : (
        <Banner tone="danger" testID="verify-error">
          {error.message}
        </Banner>
      )}
      {seconds > 0 ? (
        <Small>{t('verify.resend_in', { seconds })}</Small>
      ) : (
        <Button
          testID="resend-code"
          variant="link"
          label={t('verify.resend')}
          onPress={() => void resend()}
        />
      )}
    </Screen>
  );
}
