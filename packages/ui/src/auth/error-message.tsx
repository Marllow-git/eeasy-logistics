'use client';

import { ApiError } from '@eeasy-logistics/contracts/http';
import { formatNumber } from '@eeasy-logistics/i18n';
import { useCallback } from 'react';
import { useLocale, useTranslations } from '../intl';

/** Seconds from a `Retry-After` header (delta seconds or an HTTP date), or undefined. */
export function retryAfterSeconds(error: unknown, now: number = Date.now()): number | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const value = error.headers.get('retry-after');
  if (value === null) return undefined;
  if (/^\d{1,7}$/.test(value.trim())) return Number(value.trim());
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

/**
 * The message a form shows for a failed call (web §5: the UI's own text per error `code`, the
 * `errors` catalogue): a code the catalogue knows, `rate_limited` with the wait from `Retry-After`
 * (Western digits), a network failure as such, anything else as the generic server error. Never
 * the API's `message` or `details` text, which could carry what the user typed.
 */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations('errors');
  const auth = useTranslations('auth.errors');
  const locale = useLocale();
  return useCallback(
    (error: unknown) => {
      if (error instanceof ApiError) {
        if (error.code === 'rate_limited') {
          const seconds = retryAfterSeconds(error);
          if (seconds !== undefined && seconds > 0) {
            const minutes = Math.ceil(seconds / 60);
            return seconds < 120
              ? auth('rate_limited_seconds', {
                  count: seconds,
                  value: formatNumber(locale, seconds),
                })
              : auth('rate_limited_minutes', {
                  count: minutes,
                  value: formatNumber(locale, minutes),
                });
          }
        }
        const key = `codes.${error.code}`;
        if (t.has(key as never)) return t(key as never);
        return t('codes.internal_error');
      }
      if (error instanceof TypeError) return auth('network');
      return t('codes.internal_error');
    },
    [t, auth, locale],
  );
}
