import { usePreventScreenCapture } from 'expo-screen-capture';
import { useEffect, useState } from 'react';
import { ApiError } from '@eeasy-logistics/contracts/http';
import { isValidPin, pinMaxLength } from '../../src/domain/pin';
import { appLocale, t } from '../../src/i18n';
import { track } from '../../src/observability';
import {
  armVerifier,
  continueWithoutCash,
  newIdempotencyKey,
  requestPinOtp,
  setCashPin,
} from '../../src/sync/cash-pin';
import { CodeInput } from '../../src/ui/code-input';
import { genericErrorMessage } from '../../src/ui/errors';
import { retryAfterSeconds } from '../../src/sync/sign-in';
import { Keypad, PinDots } from '../../src/ui/keypad';
import { Banner, Body, Button, Screen, Small, Title } from '../../src/ui/kit';
import { useSessionState, useSetupState } from '../../src/ui/use-driver';

type Step = 'enter' | 'confirm' | 'otp' | 'arm' | 'locked';

/**
 * The cash PIN step (driver app §5.2, §5.3; DRV-1 plan 2.6): a first PIN entered twice and saved with
 * a fresh code, or an existing PIN entered once to arm this phone's verifier. Screenshots are off on
 * this screen; no digit is ever shown.
 */
export default function PinScreen() {
  usePreventScreenCapture();
  const { cashPinSet } = useSetupState();
  const { driverId } = useSessionState();
  const [step, setStep] = useState<Step>(cashPinSet === false ? 'enter' : 'arm');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [otp, setOtp] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  // Seconds before a code can be sent: the sign-in code went out moments ago and the server keeps a
  // 60 s cooldown per phone, so the first send may have to wait (429 with retry_after_s).
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const sendOtp = async () => {
    setMessage(undefined);
    try {
      await requestPinOtp(appLocale());
      setWait(60);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'rate_limited') {
        setWait(retryAfterSeconds(error) ?? 60);
      } else {
        setMessage(genericErrorMessage(error));
      }
    }
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const toConfirm = () => {
    setConfirm('');
    setStep('confirm');
  };

  const toOtp = () =>
    run(async () => {
      if (confirm !== pin) {
        setPin('');
        setConfirm('');
        setStep('enter');
        setMessage(t('pin.mismatch'));
        return;
      }
      setStep('otp');
      await sendOtp();
    });

  const save = () =>
    run(async () => {
      try {
        await setCashPin({ pin, otp_code: otp }, key);
        track('cash_pin_set', { driver_id: driverId ?? '' });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'otp_invalid') {
          setOtp('');
          setKey(newIdempotencyKey());
          setMessage(t('verify.otp_invalid'));
        } else {
          setMessage(genericErrorMessage(error));
        }
      }
    });

  const arm = () =>
    run(async () => {
      try {
        const result = await armVerifier(pin);
        setPin('');
        if (result === 'invalid') setMessage(t('pin.invalid'));
        if (result === 'locked') setStep('locked');
      } catch (error) {
        setMessage(genericErrorMessage(error));
      }
    });

  if (step === 'locked') {
    return (
      <Screen
        footer={
          <Button
            testID="continue-without-cash"
            label={t('pin.continue_without_cash')}
            onPress={continueWithoutCash}
          />
        }
      >
        <Title>{t('pin.locked_title')}</Title>
        <Banner tone="warning" testID="pin-locked-notice">
          {t('pin.locked_body')}
        </Banner>
      </Screen>
    );
  }

  if (step === 'otp') {
    return (
      <Screen
        footer={
          <Button
            testID="save-pin"
            label={t('pin.save')}
            disabled={otp.length !== 6}
            busy={busy}
            onPress={() => void save()}
          />
        }
      >
        <Title>{t('pin.otp_title')}</Title>
        <Body tone="muted">{t('pin.otp_body')}</Body>
        <CodeInput
          testID="pin-otp-input"
          label={t('verify.code_label')}
          value={otp}
          onChange={(value) => {
            if (value !== otp) setKey(newIdempotencyKey());
            setOtp(value);
          }}
          error={message !== undefined}
        />
        {message === undefined ? null : (
          <Banner tone="danger" testID="pin-error">
            {message}
          </Banner>
        )}
        {wait > 0 ? (
          <Small>{t('verify.resend_in', { seconds: wait })}</Small>
        ) : (
          <Button
            testID="pin-otp-send"
            variant="link"
            label={t('pin.otp_send')}
            onPress={() => void sendOtp()}
          />
        )}
      </Screen>
    );
  }

  const value = step === 'confirm' ? confirm : pin;
  const setValue = step === 'confirm' ? setConfirm : setPin;
  const titles = {
    enter: ['pin.setup_title', 'pin.setup_rule'],
    confirm: ['pin.confirm_title', 'pin.confirm_rule'],
    arm: ['pin.arm_title', 'pin.arm_body'],
  } as const;
  const [title, rule] = titles[step];
  const next = step === 'enter' ? toConfirm : step === 'confirm' ? toOtp : arm;

  return (
    <Screen
      footer={
        <Button
          testID="pin-continue"
          label={t('pin.submit')}
          disabled={step === 'confirm' ? confirm.length !== pin.length : !isValidPin(value)}
          busy={busy}
          onPress={() => void next()}
        />
      }
    >
      <Title>{t(title)}</Title>
      <Body tone="muted">{t(rule)}</Body>
      <PinDots count={value.length} max={step === 'confirm' ? pin.length : pinMaxLength} />
      {message === undefined ? null : (
        <Banner tone="danger" testID="pin-error">
          {message}
        </Banner>
      )}
      <Keypad
        value={value}
        onChange={setValue}
        maxLength={step === 'confirm' ? pin.length : pinMaxLength}
        disabled={busy}
      />
    </Screen>
  );
}
