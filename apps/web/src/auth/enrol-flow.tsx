'use client';

import { ApiError } from '@eeasy-logistics/contracts/http';
import { client } from '@eeasy-logistics/contracts/staff';
import { useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import { PhoneField, saudiMobileE164 } from '@eeasy-logistics/ui/auth/phone-field';
import { Button } from '@eeasy-logistics/ui/components/button';
import { formatPhone } from '@eeasy-logistics/i18n';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { track } from '../analytics';
import { CodeStep, nextSendAt } from './code-step';
import { authFetcher, stepStore } from './steps';

/**
 * Enrolling the phone factor on an enrolment token (WEB-2 plan 2.7; PLAT-11 2.8; the Calendly and
 * Mercor references): the phone after the fixed `+966`, then the code sent to it (a second send
 * replaces the pending phone), then a new sign-in. `second_factor_already_enrolled` explains the
 * emailed-link path. Used at sign-in (`enrolment_required`) and after the emailed re-enrolment link.
 */
export function EnrolFlow({ enrolmentToken }: { enrolmentToken: string }) {
  const t = useTranslations('auth');
  const message = useErrorMessage();
  const [step, setStep] = useState<'phone' | 'code' | 'done'>('phone');
  const [typed, setTyped] = useState('');
  const [phone, setPhone] = useState<string | undefined>();
  const [challengeId, setChallengeId] = useState<string | undefined>();
  const [availableAt, setAvailableAt] = useState<number | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const send = async (number: string) => {
    const sentAt = Date.now();
    track('auth.second_factor.requested', { surface: 'staff', purpose: 'enrolment' });
    try {
      const answer = await client.enrolSecondFactor(
        { enrolment_token: enrolmentToken, phone: number },
        { fetcher: authFetcher() },
      );
      if (answer.status !== 202 || typeof answer.data.challenge_id !== 'string') {
        throw new Error(`enrol answered ${answer.status}`);
      }
      setChallengeId(answer.data.challenge_id);
      setAvailableAt(nextSendAt(sentAt));
    } catch (failure) {
      setAvailableAt(nextSendAt(sentAt, failure));
      throw failure;
    }
  };

  const submitPhone = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const number = saudiMobileE164(typed);
    if (number === undefined) {
      setError(t('enrol.phone_invalid'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await send(number);
      setPhone(number);
      setStep('code');
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.code === 'second_factor_already_enrolled'
          ? t('enrol.already_enrolled')
          : message(failure),
      );
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <div className="flex flex-col gap-4" data-step="done">
        <h2 className="text-lg font-semibold">{t('enrol.done_title')}</h2>
        <p className="text-sm text-muted-foreground">{t('enrol.done_description')}</p>
        <Button asChild>
          <Link href="/sign-in">{t('sign_in.submit')}</Link>
        </Button>
      </div>
    );
  }

  if (step === 'code' && phone !== undefined && challengeId !== undefined) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t('enrol.code_description', { phone: formatPhone(phone) })}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            setStep('phone');
            setChallengeId(undefined);
          }}
        >
          {t('enrol.change_phone')}
        </Button>
        <CodeStep
          availableAt={availableAt}
          onRestart={stepStore.clear}
          resend={() => send(phone)}
          verify={async (code) => {
            await client.confirmSecondFactor(
              { enrolment_token: enrolmentToken, challenge_id: challengeId, code },
              { fetcher: authFetcher() },
            );
            stepStore.clear();
            setStep('done');
          }}
        />
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submitPhone(event)} noValidate>
      <PhoneField
        label={t('enrol.phone')}
        hint={t('enrol.phone_hint')}
        error={error}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        required
      />
      <Button type="submit" disabled={busy || typed.trim() === ''}>
        {t('enrol.send')}
      </Button>
    </form>
  );
}
