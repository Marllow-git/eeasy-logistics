'use client';

import { formatNumber } from '@eeasy-logistics/i18n';
import { useEffect, useState } from 'react';
import { Button } from '../components/button/button';
import { useLocale, useTranslations } from '../intl';

export interface ResendButtonProps {
  /** When the next send is allowed (epoch milliseconds); in the past or undefined means now. */
  availableAt: number | undefined;
  onResend: () => void;
  /** A send is in flight. */
  busy?: boolean;
  /** Test seam. */
  now?: () => number;
}

/**
 * "Resend code" with its cooldown (WEB-2 plan 2.10; the Notion and Visual Electric references):
 * while waiting it reads "Resend in 42 s" (Western digits, ICU plural), counts down each second and
 * is disabled; then it sends again. The page sets `availableAt` from the 60 s local timer or the
 * API's `Retry-After`, whichever is later.
 */
export function ResendButton({
  availableAt,
  onResend,
  busy = false,
  now = Date.now,
}: ResendButtonProps) {
  const t = useTranslations('auth.resend');
  const locale = useLocale();
  const [current, setCurrent] = useState(now);
  const remaining =
    availableAt === undefined ? 0 : Math.max(0, Math.ceil((availableAt - current) / 1000));

  useEffect(() => {
    if (availableAt === undefined) return undefined;
    const tick = () => setCurrent(now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [availableAt, now]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy || remaining > 0}
      onClick={onResend}
      aria-live="polite"
    >
      {remaining > 0
        ? t('wait', { count: remaining, value: formatNumber(locale, remaining) })
        : t('now')}
    </Button>
  );
}
