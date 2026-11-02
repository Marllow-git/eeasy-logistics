'use client';

import type { OutboxRow } from '@eeasy-logistics/contracts/platform';
import { Badge } from '@eeasy-logistics/ui/components/badge';
import { useTranslations } from '@eeasy-logistics/ui/intl';

// The outbox's chips (WEB-4 plan 2.8; Snowflake's "Failed" chip in words): a status in the
// catalogue's words and its tone, a kind as a neutral chip.

export const outboxStatuses = ['pending', 'enqueued', 'done', 'dead', 'superseded'] as const;
export const outboxKinds = [
  'internal_event',
  'webhook',
  'message',
  'push',
  'channel_publish',
  'carrier_call',
  'storage_lifecycle',
] as const;

const statusTone = {
  pending: 'neutral',
  enqueued: 'primary',
  done: 'success',
  dead: 'danger',
  superseded: 'neutral',
} as const;

export function OutboxStatusChip({ status }: { status: OutboxRow['status'] }) {
  const t = useTranslations('platform.outbox.statuses');
  return <Badge tone={statusTone[status]}>{t(status)}</Badge>;
}

export function OutboxKindChip({ kind }: { kind: OutboxRow['kind'] }) {
  const t = useTranslations('platform.outbox.kinds');
  return <Badge tone="neutral">{t(kind)}</Badge>;
}
