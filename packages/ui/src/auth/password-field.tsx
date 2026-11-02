'use client';

import { formatNumber } from '@eeasy-logistics/i18n';
import { Check, Eye, EyeOff } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';
import { cn } from '../cn';
import { Input } from '../components/input/input';
import { Label } from '../components/label/label';
import { useLocale, useTranslations } from '../intl';

/** The password rule of identity §3.1: a length only, no composition rule. */
export const passwordMinLength = 12;

export type PasswordFieldProps = Omit<ComponentProps<'input'>, 'type' | 'autoComplete'> & {
  label: string;
  /** `current-password` to sign in, `new-password` to choose one (shows the rules). */
  autoComplete: 'current-password' | 'new-password';
  /** An error to show under the field and announce (the API's `breached`, say). */
  error?: string | undefined;
};

/**
 * A password input with show and hide (WEB-2 plan 2.10). For a new password it lists the rule of
 * identity §3.1 with its live state and a counter ("7 of 12", Western digits), as the 1Password
 * reference shows (docs/references/design/WEB-2.md); the breached-password refusal comes from the
 * API and is passed in as `error`.
 */
export function PasswordField({
  label,
  autoComplete,
  error,
  className,
  id,
  value,
  ...props
}: PasswordFieldProps) {
  const t = useTranslations('auth.fields');
  const locale = useLocale();
  const [visible, setVisible] = useState(false);
  const generated = useId();
  const inputId = id ?? generated;
  const rulesId = `${inputId}-rules`;
  const errorId = `${inputId}-error`;
  const length = typeof value === 'string' ? [...value].length : 0;
  const isNew = autoComplete === 'new-password';
  const met = length >= passwordMinLength;
  const describedBy = [isNew ? rulesId : undefined, error === undefined ? undefined : errorId]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <div className="relative">
        <Input
          id={inputId}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          dir="ltr"
          className="pe-11"
          value={value}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          {...props}
        />
        <button
          type="button"
          className="absolute inset-y-0 end-0 flex w-10 items-center justify-center rounded-e-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={visible ? t('hide_password') : t('show_password')}
          aria-pressed={visible}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? (
            <EyeOff aria-hidden className="size-4" />
          ) : (
            <Eye aria-hidden className="size-4" />
          )}
        </button>
      </div>
      {isNew ? (
        <p
          id={rulesId}
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-met={met}
        >
          {met ? (
            <Check aria-hidden className="size-4 text-success" />
          ) : (
            <span aria-hidden className="inline-block size-4 rounded-full border border-input" />
          )}
          <span>{t('password_rule', { min: formatNumber(locale, passwordMinLength) })}</span>
          <span className="ms-auto tabular-nums">
            {t('password_count', {
              count: formatNumber(locale, Math.min(length, passwordMinLength)),
              min: formatNumber(locale, passwordMinLength),
            })}
          </span>
        </p>
      ) : null}
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
