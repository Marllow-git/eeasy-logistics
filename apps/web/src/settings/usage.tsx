import type { Account } from '@eeasy-logistics/contracts/staff';
import { formatNumber } from '@eeasy-logistics/i18n';
import { getLocale, getTranslations } from 'next-intl/server';

/**
 * The account's usage over its limits (`getAccount`; WEB-3 plan 2.5, 2.6): sites and drivers, as
 * "used of limit" in Western digits. Read-only: the platform sets the limits (PLAT-13).
 */
export async function UsageFacts({
  account,
  labelledBy,
}: {
  account: Account;
  labelledBy: string;
}) {
  const [t, locale] = await Promise.all([getTranslations('settings.usage'), getLocale()]);
  const number = (value: number) => formatNumber(locale, value);
  const facts = [
    { key: 'sites', used: account.usage?.sites ?? 0, limit: account.limits?.sites },
    { key: 'drivers', used: account.usage?.drivers ?? 0, limit: account.limits?.drivers },
  ] as const;
  return (
    <dl aria-labelledby={labelledBy} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.key} className="flex flex-col gap-1 rounded-md bg-muted px-4 py-3">
          <dt className="text-sm text-muted-foreground">{t(fact.key)}</dt>
          <dd className="text-lg font-semibold text-foreground">
            {fact.limit === undefined
              ? t('unlimited', { used: number(fact.used) })
              : t('of', { used: number(fact.used), limit: number(fact.limit) })}
          </dd>
        </div>
      ))}
    </dl>
  );
}
