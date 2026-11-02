'use client';

import { useId, type ComponentProps } from 'react';
import { cn } from '../cn';
import { Input } from '../components/input/input';
import { Label } from '../components/label/label';

/** Saudi Arabia only in wave 0 (plan §7 question 3): the prefix is fixed. */
export const phonePrefix = '+966';

/**
 * The E.164 number for what the user typed after the fixed `+966`: digits only, a leading `0` or
 * `966` dropped (people type `05…` and paste `+966 5…`); undefined unless it is a Saudi mobile
 * number (`5` and eight digits). The API normalises again and is the judge (PLAT-11 8.2 #32).
 */
export function saudiMobileE164(typed: string): string | undefined {
  let digits = typed.replace(/\D/g, '');
  if (digits.startsWith('966')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return /^5\d{8}$/.test(digits) ? `${phonePrefix}${digits}` : undefined;
}

export type PhoneFieldProps = Omit<ComponentProps<'input'>, 'type' | 'dir'> & {
  label: string;
  /** A line under the field (an example number, say). */
  hint?: string;
  error?: string | undefined;
};

/**
 * A mobile number after a fixed `+966` (WEB-2 plan 2.10; the Calendly reference): left to right
 * in both locales (web §5), `type="tel"`, `autocomplete="tel-national"`, the prefix shown before
 * the field and read as the field's description.
 */
export function PhoneField({ label, hint, error, className, id, ...props }: PhoneFieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const prefixId = `${inputId}-prefix`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [
    prefixId,
    hint === undefined ? undefined : hintId,
    error === undefined ? undefined : errorId,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <div dir="ltr" className="flex">
        <span
          id={prefixId}
          className="flex items-center rounded-s-md border border-e-0 border-input bg-muted px-3 text-sm text-muted-foreground"
        >
          {phonePrefix}
        </span>
        <Input
          id={inputId}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          dir="ltr"
          className="rounded-s-none"
          aria-describedby={describedBy}
          aria-invalid={error === undefined ? undefined : true}
          {...props}
        />
      </div>
      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
