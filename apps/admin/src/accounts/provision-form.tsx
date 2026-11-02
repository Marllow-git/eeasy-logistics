'use client';

import { client } from '@eeasy-logistics/contracts/platform';
import { Card, CardContent, CardHeader, CardTitle } from '@eeasy-logistics/ui/components/card';
import { Form, SubmitButton, useContractForm } from '@eeasy-logistics/ui/form';
import {
  CheckboxGroupField,
  NumberField,
  RadioGroupField,
  TextField,
} from '@eeasy-logistics/ui/form/fields';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { limitKeys, provisionSchema } from './account-schemas';
import { leaveNotice } from './notice';
import { isolate, useFeatureLabel } from './parts';

// Provisioning (WEB-4 plan 2.3): one `Form` on `platformProvisionAccount` in four sections, a full
// page rather than the Cofounder-style dialog (design references: no reference holds this set).
// The modules are the registered feature keys (`platformListRolloutModes`, read on the server).
// Success opens the new account with the notice "invitation sent to <email>"; a
// `validation_failed` pointer lands on its field.

type Values = typeof provisionSchema._input;

export function ProvisionForm({ featureKeys }: { featureKeys: readonly string[] }) {
  const t = useTranslations('platform');
  const fetcher = useSessionFetcher();
  const router = useRouter();
  const queryClient = useQueryClient();
  const featureLabel = useFeatureLabel();
  const form = useContractForm(provisionSchema, {
    name: '',
    default_locale: 'ar',
    limits: {
      orders_per_month: Number.NaN,
      drivers: Number.NaN,
      sites: Number.NaN,
      api_keys: Number.NaN,
    },
    modules: [],
    owner: { email: '', name: '' },
  });

  return (
    <Form
      form={form}
      className="max-w-2xl gap-6"
      onSubmit={async (values, { idempotencyKey }) => {
        const answer = await client.platformProvisionAccount(values, {
          fetcher,
          headers: { 'Idempotency-Key': idempotencyKey },
        });
        if (answer.status !== 201) throw new Error(`platformProvisionAccount ${answer.status}`);
        await queryClient.invalidateQueries({ queryKey: ['/v1/platform/accounts'] });
        leaveNotice(
          answer.data.id,
          t('provision.invited_notice', { email: isolate(values.owner.email) }),
        );
        router.push(`/accounts/${answer.data.id}`);
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t('provision.sections.account')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('provision.sections.limits')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('provision.sections.limits_hint')}</p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {limitKeys.map((key) => (
            <NumberField<Values, `limits.${typeof key}`>
              key={key}
              name={`limits.${key}`}
              label={t(`provision.limits.${key}`)}
              description={t(`provision.limits.${key}_hint`)}
              min={0}
            />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('provision.sections.modules')}</CardTitle>
        </CardHeader>
        <CardContent>
          {featureKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('provision.sections.modules_none')}</p>
          ) : (
            <CheckboxGroupField<Values, 'modules'>
              name="modules"
              label={t('provision.sections.modules')}
              description={t('provision.sections.modules_hint')}
              options={featureKeys.map((key) => ({ value: key, label: featureLabel(key) }))}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('provision.sections.owner')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('provision.sections.owner_hint')}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <TextField<Values, 'owner.email'>
            name="owner.email"
            type="email"
            label={t('provision.fields.owner_email')}
            input={{ dir: 'ltr', autoComplete: 'off' }}
          />
          <TextField<Values, 'owner.name'>
            name="owner.name"
            label={t('provision.fields.owner_name')}
            input={{ dir: 'auto', autoComplete: 'off' }}
          />
        </CardContent>
      </Card>
      <SubmitButton>{t('provision.submit')}</SubmitButton>
    </Form>
  );
}
