'use client';

import { client, type RolloutMode } from '@eeasy-logistics/contracts/platform';
import { formatDateTime } from '@eeasy-logistics/i18n';
import { useCan } from '@eeasy-logistics/ui/authz';
import { Card, CardContent } from '@eeasy-logistics/ui/components/card';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { ReasonDialog } from '@eeasy-logistics/ui/components/reason-dialog';
import { SegmentedChoice } from '@eeasy-logistics/ui/components/segmented-choice';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useId, useState } from 'react';
import { isolate, shortId, useFeatureLabel } from '../accounts/parts';
import { bodyReasonMax } from '../support/reason-store';

// Rollout modes (WEB-4 plan 2.6, ADR-0006; design references: Shopify's reach written under the
// control, Buffer's "takes a few minutes" notice): every registered key with its mode as a
// segmented choice (off, allowlist, all) and the selected mode's meaning in words under it, when
// and by whom it last changed. A change is the super admin's (`platform.rollout.manage`): the
// reason dialog (5 to 500), then `platformSetRolloutMode`. A caller with `platform.flags.manage`
// but not the rollout permission sees the control disabled with `rollout_change_forbidden`'s
// message (the API answers the same), anyone else with the "your role" line.

const modes = ['off', 'allowlist', 'all'] as const;
type Mode = (typeof modes)[number];

function ModeRow({ row, onChanged }: { row: RolloutMode; onChanged: (row: RolloutMode) => void }) {
  const t = useTranslations('platform');
  const errors = useTranslations('errors');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const featureLabel = useFeatureLabel();
  const canChange = useCan('platform.rollout.manage');
  const canFlags = useCan('platform.flags.manage');
  const id = useId();
  const [asking, setAsking] = useState<Mode | null>(null);
  const key = row.feature_key ?? '';
  const feature = featureLabel(key);
  const mode = row.mode ?? 'allowlist';
  const why = canChange
    ? undefined
    : canFlags
      ? errors('codes.rollout_change_forbidden')
      : t('authz.not_permitted');
  return (
    <li className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-name`} className="font-semibold text-foreground">
          {feature}
        </h2>
        <SegmentedChoice
          label={feature}
          options={modes.map((value) => ({ value, label: t(`rollout.modes.${value}`) }))}
          value={mode}
          disabled={!canChange}
          describedBy={`${id}-meaning${why === undefined ? '' : ` ${id}-why`}`}
          onValueChange={(value) => {
            if (value !== mode) setAsking(value as Mode);
          }}
        />
      </div>
      <p id={`${id}-meaning`} className="text-sm text-foreground">
        {t(`rollout.meaning.${mode}`)}
      </p>
      {why === undefined ? null : (
        <p id={`${id}-why`} className="text-sm text-muted-foreground">
          {why}
        </p>
      )}
      <p data-census-mask="" className="text-xs text-muted-foreground">
        {row.updated_at === undefined
          ? t('rollout.never_changed')
          : row.updated_by
            ? t('rollout.updated', {
                date: formatDateTime(locale, row.updated_at, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
                who: isolate(shortId(row.updated_by)),
              })
            : t('rollout.updated_on', {
                date: formatDateTime(locale, row.updated_at, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
      </p>
      {asking === null ? null : (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          title={t('rollout.dialog.title', { feature, mode: t(`rollout.modes.${asking}`) })}
          description={t(`rollout.meaning.${asking}`)}
          consequences={[t('flags.delay_notice')]}
          confirmLabel={t('rollout.dialog.confirm')}
          tone={asking === 'off' ? 'danger' : 'primary'}
          max={bodyReasonMax}
          onConfirm={async (reason, idempotencyKey) => {
            const answer = await client.platformSetRolloutMode(
              key,
              { mode: asking, reason },
              { fetcher, headers: { 'Idempotency-Key': idempotencyKey } },
            );
            if (answer.status !== 200) throw new Error(`platformSetRolloutMode ${answer.status}`);
            setAsking(null);
            onChanged(answer.data);
          }}
        />
      )}
    </li>
  );
}

export function RolloutScreen({ initial }: { initial: readonly RolloutMode[] }) {
  const t = useTranslations('platform');
  const [rows, setRows] = useState(initial);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <PageHeader title={t('nav.rollout')} description={t('rollout.description')} />
      <p role="status" className="mb-4 text-sm text-foreground empty:hidden">
        {saved}
      </p>
      <Card>
        <CardContent>
          <ul>
            {rows.map((row) => (
              <ModeRow
                key={row.feature_key}
                row={row}
                onChanged={(next) => {
                  setRows((current) =>
                    current.map((item) => (item.feature_key === next.feature_key ? next : item)),
                  );
                  setSaved(t('rollout.done'));
                }}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
