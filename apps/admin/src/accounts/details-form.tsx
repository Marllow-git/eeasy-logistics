'use client';

import { client, hooks, type Account } from '@eeasy-logistics/contracts/platform';
import { formatNumber } from '@eeasy-logistics/i18n';
import { useCan } from '@eeasy-logistics/ui/authz';
import { Card, CardContent, CardHeader, CardTitle } from '@eeasy-logistics/ui/components/card';
import { Form, SubmitButton, useContractForm } from '@eeasy-logistics/ui/form';
import { NumberField, RadioGroupField, TextField } from '@eeasy-logistics/ui/form/fields';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { useSupportReason } from '../support/support-reason';
import { detailsSchema, limitKeys } from './account-schemas';

// The details form of the Details tab (WEB-4 plan 2.5), in its own chunk: it holds
// react-hook-form, which the account route loads only once the tab renders.

type Values = typeof detailsSchema._input;

export function DetailsForm({ account }: { account: Account }) {
  const t = useTranslations('platform');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  const { headers } = useSupportReason();
  const canChange = useCan('platform.accounts.provision');
  const limits = account.limits ?? {};
  const form = useContractForm(
    detailsSchema,
    {
      name: account.name ?? '',
      default_locale: account.default_locale ?? 'ar',
      limits: {
        orders_per_month: limits.orders_per_month ?? 0,
        drivers: limits.drivers ?? 0,
        sites: limits.sites ?? 0,
        api_keys: limits.api_keys ?? 0,
      },
    },
    { disabled: !canChange },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.details.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {canChange ? t('account.details.description') : t('account.details.read_only')}
        </p>
      </CardHeader>
      <CardContent>
        <Form
          form={form}
          onSubmit={async (_values, { changed, idempotencyKey }) => {
            const answer = await client.platformUpdateAccount(account.id, changed, {
              fetcher,
              headers: { ...headers, 'Idempotency-Key': idempotencyKey },
            });
            if (answer.status !== 200) throw new Error(`platformUpdateAccount ${answer.status}`);
            queryClient.setQueryData(hooks.getPlatformGetAccountQueryKey(account.id), answer);
            const next = answer.data.limits ?? {};
            form.reset({
              name: answer.data.name ?? '',
              default_locale: answer.data.default_locale ?? 'ar',
              limits: {
                orders_per_month: next.orders_per_month ?? 0,
                drivers: next.drivers ?? 0,
                sites: next.sites ?? 0,
                api_keys: next.api_keys ?? 0,
              },
            });
          }}
        >
          <TextField<Values, 'name'>
            name="name"
            label={t('provision.fields.name')}
            description={t('provision.fields.name_hint')}
            input={{ dir: 'auto', autoComplete: 'off', maxLength: 80 }}
          />
          <RadioGroupField<Values, 'default_locale'>
            name="default_locale"
            label={t('provision.fields.default_locale')}
            options={[
              { value: 'ar', label: t('locales.ar') },
              { value: 'en', label: t('locales.en') },
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {limitKeys.map((key) => (
              <NumberField<Values, `limits.${typeof key}`>
                key={key}
                name={`limits.${key}`}
                label={t(`provision.limits.${key}`)}
                description={t('account.details.usage', {
                  used: formatNumber(locale, account.usage?.[key] ?? 0),
                })}
                min={0}
              />
            ))}
          </div>
          {canChange ? <SubmitButton>{t('account.details.save')}</SubmitButton> : null}
        </Form>
      </CardContent>
    </Card>
  );
}
