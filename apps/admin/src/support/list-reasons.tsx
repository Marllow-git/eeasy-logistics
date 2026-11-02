'use client';

import { ReasonDialog } from '@eeasy-logistics/ui/components/reason-dialog';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { headerReasonLength, headerReasonMax, supportHeaders } from './reason-store';

// The support reasons of the lists outside an account's routes (web §3.5; WEB-4 plan 2.8, 2.11):
// the outbox and the platform audit log filtered by one account, and an outbox row's drawer, read
// that account's data through the door, so they ask the reason first, keyed to the account. The
// contract also requires `X-Support-Reason` on both lists without an account (8.2: no door, no
// audit row then, but the header is declared required), so the platform-wide view asks once too,
// keyed `platform`. Held in this tab's memory only (§3.5's letter): kept while the tab moves
// between the outbox and the audit log, gone on a reload and on sign-out (`clearListReasons`,
// called by the janitor). The account routes keep theirs in `sessionStorage` (support-reason.tsx).

/** The key of the platform-wide reason (no account filter). */
const platformScope = 'platform';
const keyOf = (accountId: string | undefined) => (accountId ?? platformScope).toLowerCase();

const reasons = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forgets every list reason (sign-out). */
export function clearListReasons(): void {
  if (reasons.size === 0) return;
  reasons.clear();
  changed();
}

export interface ListReasons {
  /** The tab's reason for `accountId` (none: the platform-wide one), if given. */
  readonly reasonOf: (accountId: string | undefined) => string | undefined;
  readonly setReason: (accountId: string | undefined, reason: string) => void;
  /** `X-Support-Reason` for a call on `accountId` (none: platform-wide), if a reason is held. */
  readonly headersOf: (accountId: string | undefined) => Record<string, string>;
}

export function useListReasons(): ListReasons {
  // Re-render on every change; the reads below go to the map.
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  const reasonOf = useCallback(
    (accountId: string | undefined) => reasons.get(keyOf(accountId)),
    [],
  );
  const setReason = useCallback((accountId: string | undefined, reason: string) => {
    reasons.set(keyOf(accountId), reason);
    changed();
  }, []);
  const headersOf = useCallback(
    (accountId: string | undefined) => supportHeaders(reasonOf(accountId)),
    [reasonOf],
  );
  return { reasonOf, setReason, headersOf };
}

/**
 * The reason dialog of a list (the header's bound), for one account or (no `accountId`) every
 * account: confirm keeps the reason in this tab; cancel or Escape calls `onCancel`.
 */
export function AccountReasonDialog({
  accountId,
  accountLabel,
  onCancel,
}: {
  accountId: string | undefined;
  /** The account's name, or its short number when the name is not known yet. */
  accountLabel: string;
  onCancel: () => void;
}) {
  const t = useTranslations('platform.filter_gate');
  const { setReason } = useListReasons();
  const confirmed = useRef(false);
  return (
    <ReasonDialog
      open
      onOpenChange={(open) => {
        if (!open && !confirmed.current) onCancel();
      }}
      title={t('title', { name: accountId === undefined ? t('all_accounts') : accountLabel })}
      description={t('description')}
      label={t('label')}
      tone="primary"
      confirmLabel={t('confirm')}
      max={headerReasonMax}
      measure={headerReasonLength}
      onConfirm={(reason) => {
        confirmed.current = true;
        setReason(accountId, reason);
        return Promise.resolve();
      }}
    />
  );
}
