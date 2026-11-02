'use client';

import {
  client,
  hooks,
  type FeatureFlag,
  type RolloutMode,
} from '@eeasy-logistics/contracts/platform';
import { formatDateTime } from '@eeasy-logistics/i18n';
import { useCan } from '@eeasy-logistics/ui/authz';
import { Card, CardContent, CardHeader, CardTitle } from '@eeasy-logistics/ui/components/card';
import { ReasonDialog } from '@eeasy-logistics/ui/components/reason-dialog';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { Switch } from '@eeasy-logistics/ui/components/switch';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { bodyReasonMax } from '../support/reason-store';
import { useSupportReason } from '../support/support-reason';
import { accountOf, useAccount } from './account-frame';
import { isolate, LoadError, shortId, useFeatureLabel } from './parts';

// The account's Modules tab (WEB-4 plan 2.6; design references: Buffer for one line per flag with
// what it changes and the "takes a few minutes" notice, Supabase for a list with its state): one
// row per registered key (`platformListFeatureFlags` under the door) with a switch for
// `platform.flags.manage`, the reason dialog on every change (`platformSetFeatureFlag`), when and
// by whom it was turned on, and what the account gets in words, from the key's rollout mode
// (`platformListRolloutModes`, read once).

function effectOf(
  mode: RolloutMode['mode'],
  enabled: boolean,
): 'all' | 'off' | 'on_here' | 'off_here' {
  if (mode === 'all') return 'all';
  if (mode === 'off') return 'off';
  return enabled ? 'on_here' : 'off_here';
}

function FlagRow({
  accountId,
  accountName,
  flag,
  mode,
  onSaved,
}: {
  accountId: string;
  accountName: string;
  flag: FeatureFlag;
  mode: RolloutMode['mode'];
  onSaved: (message: string) => void;
}) {
  const t = useTranslations('platform');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  const support = useSupportReason();
  const canManage = useCan('platform.flags.manage');
  const featureLabel = useFeatureLabel();
  const id = useId();
  const [asking, setAsking] = useState(false);
  const key = flag.feature_key ?? '';
  const enabled = flag.enabled === true;
  const feature = featureLabel(key);
  const next = !enabled;
  return (
    <li className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={`${id}-switch`} className="font-semibold text-foreground">
          {feature}
        </label>
        {/* A reader without `platform.flags.manage` sees the state in words, no control (§5). */}
        {canManage ? (
          <Switch
            id={`${id}-switch`}
            checked={enabled}
            aria-label={t('flags.switch_label', { feature })}
            aria-describedby={`${id}-effect`}
            onCheckedChange={() => setAsking(true)}
          />
        ) : null}
      </div>
      <p id={`${id}-effect`} className="text-sm text-foreground">
        {t(`flags.effect.${effectOf(mode, enabled)}`)}
      </p>
      <p data-census-mask="" className="text-xs text-muted-foreground">
        {flag.enabled_at
          ? t('flags.enabled_at', {
              date: formatDateTime(locale, flag.enabled_at, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })
          : t('flags.never')}
        {flag.provisioned_by ? (
          <> · {t('flags.provisioned_by', { who: isolate(shortId(flag.provisioned_by)) })}</>
        ) : null}
      </p>
      {asking ? (
        <ReasonDialog
          open
          onOpenChange={setAsking}
          title={t(next ? 'flags.dialog.on_title' : 'flags.dialog.off_title', {
            feature,
            name: accountName,
          })}
          description={t('flags.dialog.description')}
          consequences={[t('flags.delay_notice')]}
          confirmLabel={t(next ? 'flags.dialog.on_confirm' : 'flags.dialog.off_confirm')}
          tone={next ? 'primary' : 'danger'}
          max={bodyReasonMax}
          initialReason={support.reason}
          onConfirm={async (reason, idempotencyKey) => {
            await client.platformSetFeatureFlag(
              accountId,
              key,
              { enabled: next, reason },
              { fetcher, headers: { 'Idempotency-Key': idempotencyKey } },
            );
            await queryClient.invalidateQueries({
              queryKey: hooks.getPlatformListFeatureFlagsQueryKey(accountId),
            });
            onSaved(t('flags.done'));
          }}
        />
      ) : null}
    </li>
  );
}

export function FlagsTab({ accountId }: { accountId: string }) {
  const t = useTranslations('platform.flags');
  const fetcher = useSessionFetcher();
  const { headers } = useSupportReason();
  const account = accountOf(useAccount(accountId));
  const [saved, setSaved] = useState<string | null>(null);
  const flags = hooks.usePlatformListFeatureFlags(accountId, { request: { fetcher, headers } });
  const modes = hooks.usePlatformListRolloutModes({ request: { fetcher } });
  const modeOf = (key: string | undefined) =>
    modes.data?.status === 200
      ? modes.data.data.data?.find((row) => row.feature_key === key)?.mode
      : undefined;
  const rows = flags.data?.status === 200 ? (flags.data.data.data ?? []) : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <p className="text-sm text-muted-foreground">{t('delay_notice')}</p>
      </CardHeader>
      <CardContent>
        <p role="status" className="text-sm text-foreground empty:hidden">
          {saved}
        </p>
        {flags.isError ? (
          <LoadError error={flags.error} onRetry={() => void flags.refetch()} />
        ) : rows === undefined || account === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <ul>
            {rows.map((flag) => (
              <FlagRow
                key={flag.feature_key}
                accountId={accountId}
                accountName={account.name ?? ''}
                flag={flag}
                mode={modeOf(flag.feature_key)}
                onSaved={setSaved}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
