'use client';

import { useSignOutCleanup } from '@eeasy-logistics/ui/session';
import { usePathname } from 'next/navigation';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { accountOfPath, keepOnly, readReason, supportHeaders, writeReason } from './reason-store';

// The tab's support reason in React (web §3.5; WEB-4 plan 2.4). `SupportReasonJanitor` (in the
// platform layout) removes every account's reason the tab is no longer on, on each route change
// and on sign-out; `SupportReasonProvider` (in the account layout) reads the one account's reason
// from the tab's storage (never on the server, which has none) and sets it when the reason dialog
// is confirmed. Cross-tenant queries wait for `reason`.

// Who reads the stored reasons; told after every write or removal in this tab.
const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notify(): void {
  for (const listener of listeners) listener();
}

/** Removes the reasons of the accounts the tab has left, and all of them on sign-out. */
export function SupportReasonJanitor() {
  const pathname = usePathname();
  useEffect(() => {
    keepOnly(window.sessionStorage, accountOfPath(pathname));
    notify();
  }, [pathname]);
  const clear = useCallback(() => {
    keepOnly(window.sessionStorage, undefined);
    notify();
  }, []);
  useSignOutCleanup(clear);
  return null;
}

export interface SupportReason {
  readonly accountId: string;
  /** The tab's reason for this account; undefined until given (or before the storage is read). */
  readonly reason: string | undefined;
  /** False until the storage has been read: the dialog waits for it, so a reload does not ask. */
  readonly loaded: boolean;
  readonly setReason: (reason: string) => void;
  /** `X-Support-Reason` for a cross-tenant call: the reason, or none before it is given. */
  readonly headers: Record<string, string>;
}

const SupportReasonContext = createContext<SupportReason | null>(null);

export function SupportReasonProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  // `undefined` on the server and during hydration (no storage there), `null` for no reason.
  const stored = useSyncExternalStore(
    subscribe,
    () => readReason(window.sessionStorage, accountId) ?? null,
    () => undefined,
  );
  const setReason = useCallback(
    (reason: string) => {
      writeReason(window.sessionStorage, accountId, reason);
      notify();
    },
    [accountId],
  );
  const value = useMemo(
    () => ({
      accountId,
      reason: stored ?? undefined,
      loaded: stored !== undefined,
      setReason,
      headers: supportHeaders(stored ?? undefined),
    }),
    [accountId, stored, setReason],
  );
  return <SupportReasonContext value={value}>{children}</SupportReasonContext>;
}

export function useSupportReason(): SupportReason {
  const value = use(SupportReasonContext);
  if (value === null) throw new Error('useSupportReason outside SupportReasonProvider');
  return value;
}
