'use client';

import { ApiError } from '@eeasy-logistics/contracts/http';
import { formatNumber } from '@eeasy-logistics/i18n';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useCallback } from 'react';

/**
 * The sites pages' own text for two refusals (WEB-3 plan 2.8): `limit_exceeded` with the account's
 * site limit (`getAccount`), `site_in_use` with its reasons (PLAT-12 #15: `details.reasons`, each
 * named from the catalogue, the raw reason otherwise). Anything else takes the catalogue's text.
 */
export function useSiteRefusal(siteLimit: number | undefined) {
  const t = useTranslations('settings.sites');
  const errors = useTranslations('errors.codes');
  const locale = useLocale();
  return useCallback(
    (error: unknown): string | undefined => {
      if (!(error instanceof ApiError)) return undefined;
      if (error.code === 'limit_exceeded' && siteLimit !== undefined) {
        return t('limit_reached', { limit: formatNumber(locale, siteLimit) });
      }
      if (error.code === 'site_in_use') {
        const reasons = Array.isArray(error.details?.reasons) ? error.details.reasons : [];
        const named = reasons.map((reason) => {
          const key = `in_use_reasons.${String(reason)}` as 'in_use_reasons.open_orders';
          return t.has(key) ? t(key) : String(reason);
        });
        return named.length === 0
          ? errors('site_in_use')
          : `${t('deactivate.in_use')} ${named.join(locale === 'ar' ? '، ' : ', ')}`;
      }
      return undefined;
    },
    [t, errors, locale, siteLimit],
  );
}
