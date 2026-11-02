'use client';

import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '../cn';
import { useTranslations } from '../intl';

/** One-time codes are six digits (identity §3.1, §3.3; staff.yaml `^[0-9]{6}$`). */
export const codeLength = 6;

export interface CodeInputProps {
  /** The digits entered so far (at most six, digits only). */
  value: string;
  onChange: (value: string) => void;
  /** Called once all six digits are in, by typing or by pasting. */
  onComplete?: (value: string) => void;
  /** The visible label of the group (`auth.fields.code` by default). */
  label?: string;
  /** An error to show under the cells and announce. */
  error?: string | undefined;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

const onlyDigits = (text: string) => text.replace(/\D/g, '');

/**
 * Six cells for a one-time code (WEB-2 plan 2.10; the Visual Electric and Calendly references of
 * docs/references/design/WEB-2.md). The cells run left to right in both locales (`dir="ltr"`,
 * web §5: codes are LTR inside an RTL page) with logical spacing; typing moves forward, Backspace
 * on an empty cell and the arrow keys move between cells, and pasting six digits anywhere fills all
 * of them. The first cell carries `autocomplete="one-time-code"` so the platform can offer the code;
 * every cell is `inputmode="numeric"` and has its own label. An error is announced (`role="alert"`).
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  label,
  error,
  disabled = false,
  autoFocus = false,
  className,
}: CodeInputProps) {
  const t = useTranslations('auth.fields');
  const id = useId();
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const digits = onlyDigits(value).slice(0, codeLength);

  const focus = (index: number) => {
    const cell = cells.current[Math.max(0, Math.min(codeLength - 1, index))];
    cell?.focus();
    cell?.select();
  };

  const update = (next: string, focusAt?: number) => {
    const clean = onlyDigits(next).slice(0, codeLength);
    onChange(clean);
    if (focusAt !== undefined) focus(focusAt);
    if (clean.length === codeLength && clean !== digits) onComplete?.(clean);
  };

  const typeAt = (index: number, text: string) => {
    const typed = onlyDigits(text);
    if (typed === '') return;
    if (typed.length >= codeLength) {
      update(typed, codeLength - 1);
      return;
    }
    // Cells fill from the first empty one: a code has no gaps.
    const start = Math.min(index, digits.length);
    const next = (digits.slice(0, start) + typed + digits.slice(start + typed.length)).slice(
      0,
      codeLength,
    );
    update(next, start + typed.length);
  };

  const keyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (index < digits.length) update(digits.slice(0, index) + digits.slice(index + 1), index);
      else if (index > 0) update(digits.slice(0, index - 1), index - 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focus(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focus(Math.min(index + 1, digits.length));
    } else if (event.key === 'Home') {
      event.preventDefault();
      focus(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focus(Math.min(digits.length, codeLength - 1));
    }
  };

  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = onlyDigits(event.clipboardData.getData('text'));
    if (text === '') return;
    event.preventDefault();
    update(text.slice(0, codeLength), Math.min(text.length, codeLength - 1));
  };

  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span id={labelId} className="text-sm font-semibold text-foreground">
        {label ?? t('code')}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={error === undefined ? undefined : errorId}
        dir="ltr"
        className="flex gap-2"
      >
        {Array.from({ length: codeLength }, (_, index) => (
          <input
            key={index}
            ref={(cell) => {
              cells.current[index] = cell;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={codeLength}
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            autoFocus={autoFocus && index === 0}
            disabled={disabled}
            aria-label={t('code_digit', { position: String(index + 1) })}
            aria-invalid={error === undefined ? undefined : true}
            value={digits[index] ?? ''}
            onChange={(event) => {
              const raw = event.target.value;
              typeAt(index, raw.length > 1 ? raw.replace(digits[index] ?? '', '') : raw);
            }}
            onKeyDown={(event) => keyDown(index, event)}
            onPaste={paste}
            onFocus={(event) => event.target.select()}
            className="size-11 rounded-md border border-input bg-background text-center text-lg font-semibold text-foreground tabular-nums focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 aria-invalid:border-danger"
          />
        ))}
      </div>
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
