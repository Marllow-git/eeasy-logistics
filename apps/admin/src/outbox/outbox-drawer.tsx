'use client';

import { client, hooks, type OutboxRow } from '@eeasy-logistics/contracts/platform';
import { ApiError } from '@eeasy-logistics/contracts/http';
import { formatNumber } from '@eeasy-logistics/i18n';
import { useCan } from '@eeasy-logistics/ui/authz';
import { Button } from '@eeasy-logistics/ui/components/button';
import { CodeBlock } from '@eeasy-logistics/ui/components/code-block';
import { DateTime } from '@eeasy-logistics/ui/components/date-time';
import { ReasonDialog } from '@eeasy-logistics/ui/components/reason-dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@eeasy-logistics/ui/components/sheet';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { LoadError, isolate, shortId } from '../accounts/parts';
import { useAccountLabel } from '../lists/account-filter';
import { AccountReasonDialog, useListReasons } from '../support/list-reasons';
import { bodyReasonMax } from '../support/reason-store';
import { OutboxKindChip, OutboxStatusChip } from './outbox-parts';

// One outbox row in a right-hand drawer (WEB-4 plan 2.8; design references: Gumloop's run drawer
// with its summary block and the output as code, Snowflake's error under the statement): the row
// of an account is read through that account's door (`platformGetOutboxRow`, the reason asked
// first when the tab holds none for it), a platform-only row as metadata. "Replay" on a dead row
// for `platform.outbox.replay`: the reason dialog (the body's 500), never one click; a refusal
// (`replay_not_allowed`) says why in words, a running job included.

const refusals = ['not_dead', 'outside_receipt_window', 'supersede_pending', 'job_active'] as const;

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Id({ value }: { value: string }) {
  return (
    <bdi dir="ltr" className="font-mono text-xs break-all">
      {value}
    </bdi>
  );
}

function DrawerBody({ row: listed, headers }: { row: OutboxRow; headers: Record<string, string> }) {
  const t = useTranslations('platform.outbox');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  const canReplay = useCan('platform.outbox.replay');
  const { reasonOf } = useListReasons();
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const read = hooks.usePlatformGetOutboxRow(listed.id, { request: { fetcher, headers } });
  if (read.isError) return <LoadError error={read.error} onRetry={() => void read.refetch()} />;
  if (read.data?.status !== 200) return <Skeleton className="h-64 w-full" />;
  const row = read.data.data;
  const none = <span className="text-muted-foreground">{t('none')}</span>;
  const when = (value: string | null | undefined) =>
    value ? <DateTime value={value} timeStyle="medium" /> : none;
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-sm text-foreground empty:hidden">
        {done}
      </p>
      <dl className="grid grid-cols-2 gap-3">
        <Fact term={t('columns.status')}>
          <OutboxStatusChip status={row.status} />
        </Fact>
        <Fact term={t('columns.kind')}>
          <OutboxKindChip kind={row.kind} />
        </Fact>
        <Fact term={t('columns.attempts')}>{formatNumber(locale, row.attempts)}</Fact>
        <Fact term={t('columns.account')}>
          {row.account_id === null ? t('platform_only') : isolate(shortId(row.account_id))}
        </Fact>
        <Fact term={t('columns.created')}>{when(row.created_at)}</Fact>
        <Fact term={t('columns.next_attempt')}>{when(row.next_attempt_at)}</Fact>
        <Fact term={t('drawer.enqueued')}>{when(row.enqueued_at)}</Fact>
        <Fact term={t('drawer.done')}>{when(row.done_at)}</Fact>
        <Fact term={t('drawer.aggregate')}>
          <Id value={`${row.aggregate_type} ${row.aggregate_id}`} />
        </Fact>
        <Fact term={t('drawer.sequence')}>{formatNumber(locale, row.sequence)}</Fact>
      </dl>
      {row.last_error ? <CodeBlock label={t('drawer.last_error')} value={row.last_error} /> : null}
      {row.envelope === undefined ? (
        <p className="text-sm text-muted-foreground">{t('drawer.metadata_only')}</p>
      ) : (
        <CodeBlock label={t('drawer.envelope')} value={row.envelope} />
      )}
      {canReplay && row.status === 'dead' ? (
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <Button variant="danger" className="self-start" onClick={() => setAsking(true)}>
            {t('replay.button')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('replay.hint')}</p>
        </div>
      ) : null}
      {asking ? (
        <ReasonDialog
          open
          onOpenChange={setAsking}
          title={t('replay.title', { type: row.type })}
          description={t('replay.description')}
          consequences={[t('replay.consequence')]}
          confirmLabel={t('replay.confirm')}
          tone="danger"
          max={bodyReasonMax}
          initialReason={reasonOf(row.account_id ?? undefined)}
          describeError={(error) => {
            if (!(error instanceof ApiError) || error.code !== 'replay_not_allowed') {
              return undefined;
            }
            const why = error.details?.reason;
            return refusals.includes(why as never)
              ? t(`replay.refusals.${why as (typeof refusals)[number]}`)
              : undefined;
          }}
          onConfirm={async (reason, idempotencyKey) => {
            await client.platformReplayOutboxRow(
              row.id,
              { reason },
              { fetcher, headers: { 'Idempotency-Key': idempotencyKey } },
            );
            setDone(t('replay.done'));
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: hooks.getPlatformGetOutboxRowQueryKey(row.id),
              }),
              queryClient.invalidateQueries({ queryKey: ['/v1/platform/outbox'] }),
            ]);
          }}
        />
      ) : null}
    </div>
  );
}

export function OutboxDrawer({ row, onClose }: { row: OutboxRow; onClose: () => void }) {
  const t = useTranslations('platform.outbox');
  const { reasonOf, headersOf } = useListReasons();
  const accountId = row.account_id ?? undefined;
  const accountLabel = useAccountLabel(accountId);
  if (reasonOf(accountId) === undefined) {
    return (
      <AccountReasonDialog accountId={accountId} accountLabel={accountLabel} onCancel={onClose} />
    );
  }
  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent>
        <SheetTitle>
          <bdi dir="ltr" className="font-mono">
            {row.type}
          </bdi>
        </SheetTitle>
        <SheetDescription>
          {accountId === undefined
            ? t('platform_only')
            : t('drawer.of_account', { name: accountLabel })}{' '}
          <Id value={row.id} />
        </SheetDescription>
        <DrawerBody row={row} headers={headersOf(accountId)} />
      </SheetContent>
    </Sheet>
  );
}
