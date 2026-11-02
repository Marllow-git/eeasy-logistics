'use client';

import { client, hooks, type Site } from '@eeasy-logistics/contracts/staff';
import { Form, SubmitButton, useContractForm } from '@eeasy-logistics/ui/form';
import { BilingualField, RadioGroupField, TextAreaField } from '@eeasy-logistics/ui/form/fields';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import {
  OpeningHoursEditor,
  PointFields,
  ShortCodeField,
  siteFormSchema,
  siteFormValues,
  type SiteFormValues,
} from '@eeasy-logistics/ui/settings/site-form';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { siteQueryRoot } from './site-keys';
import { useSiteRefusal } from './site-refusal';

// One site's form (WEB-3 plan 2.8): kind, the bilingual names, the address, the short code, the
// point and the opening hours, sent whole to `createSite` or `updateSite` with the intent's key
// (an empty optional field is left out, which the API reads as cleared). A member without
// `core.sites.manage` sees the values disabled and no save. Loaded with `next/dynamic`.

const kinds = ['branch', 'warehouse', 'both'] as const;

export function SiteForm({
  site,
  manage,
  siteLimit,
}: {
  site?: Site;
  manage: boolean;
  siteLimit?: number;
}) {
  const t = useTranslations('settings.sites');
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  const router = useRouter();
  const describeError = useSiteRefusal(siteLimit);
  const form = useContractForm(siteFormSchema, siteFormValues(site), { disabled: !manage });

  return (
    <Form
      form={form}
      describeError={describeError}
      className="gap-6"
      onSubmit={async (body, { idempotencyKey }) => {
        const headers = { 'Idempotency-Key': idempotencyKey };
        if (site === undefined) {
          const answer = await client.createSite(body, { fetcher, headers });
          const created = answer.data as Site;
          await queryClient.invalidateQueries({ queryKey: [siteQueryRoot] });
          router.replace(`/settings/sites/${created.id}?created=1`);
          return;
        }
        const answer = await client.updateSite(site.id, body, { fetcher, headers });
        const updated = answer.data as Site;
        queryClient.setQueryData(hooks.getGetSiteQueryKey(site.id), {
          data: updated,
          status: answer.status,
        });
        form.reset(siteFormValues(updated));
        await queryClient.invalidateQueries({ queryKey: [siteQueryRoot] });
      }}
    >
      <RadioGroupField<SiteFormValues, 'kind'>
        name="kind"
        label={t('form.kind')}
        options={kinds.map((kind) => ({
          value: kind,
          label: t(`kinds.${kind}`),
          description: t(`kind_hints.${kind}`),
        }))}
      />
      <BilingualField<SiteFormValues, 'name_ar', 'name_en'>
        names={{ ar: 'name_ar', en: 'name_en' }}
        legend={t('form.names')}
        description={t('form.names_hint')}
      />
      <TextAreaField<SiteFormValues, 'address_text'>
        name="address_text"
        label={t('form.address')}
        description={t('form.address_hint')}
        maxLength={500}
      />
      <ShortCodeField />
      <PointFields />
      <OpeningHoursEditor disabled={!manage} />
      {manage ? (
        <SubmitButton requireChange={site !== undefined}>
          {site === undefined ? t('form.create') : t('form.save')}
        </SubmitButton>
      ) : null}
    </Form>
  );
}
