'use client';

import { client, hooks, type Site } from '@eeasy-logistics/contracts/staff';
import { ConfirmDialog } from '@eeasy-logistics/ui/components/confirm-dialog';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { siteQueryRoot } from './site-keys';
import { useSiteRefusal } from './site-refusal';

// Deactivate and activate a site (WEB-3 plan 2.8; design reference: Workable's dialog saying what
// stops and that it reverses). `site_in_use` lists its reasons and `limit_exceeded` names the
// account's limit inside the dialog; the answer replaces the cached site and the lists refresh.
// Loaded with `next/dynamic` on first open.

export function SiteStateDialog({
  site,
  siteLimit,
  open,
  onOpenChange,
  onDone,
}: {
  site: Site;
  siteLimit: number | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations('settings.sites');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  const describeError = useSiteRefusal(siteLimit);
  const deactivate = site.status !== 'inactive';
  const name = locale === 'ar' ? site.name_ar : site.name_en;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone={deactivate ? 'danger' : 'primary'}
      title={deactivate ? t('deactivate.title', { name }) : t('activate.title', { name })}
      consequences={
        deactivate
          ? [t('deactivate.consequence_work'), t('deactivate.consequence_keep')]
          : [t('activate.consequence')]
      }
      confirmLabel={deactivate ? t('deactivate.confirm') : t('activate.confirm')}
      describeError={describeError}
      onConfirm={async (idempotencyKey) => {
        const options = { fetcher, headers: { 'Idempotency-Key': idempotencyKey } };
        const answer = deactivate
          ? await client.deactivateSite(site.id, options)
          : await client.activateSite(site.id, options);
        queryClient.setQueryData(hooks.getGetSiteQueryKey(site.id), {
          data: answer.data as Site,
          status: answer.status,
        });
        await queryClient.invalidateQueries({ queryKey: [siteQueryRoot] });
        onDone(deactivate ? t('deactivate.done') : t('activate.done'));
      }}
    />
  );
}
