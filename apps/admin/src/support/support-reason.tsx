'use client';

import type { PlatformMe } from '@eeasy-logistics/contracts/platform';
import { useSession, useSessionEndCleanup } from '@eeasy-logistics/ui/session';
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
import { clearListReasons } from './list-reasons';
import { accountOfPath, keepOnly, readReason, supportHeaders, writeReason } from './reason-store';

// The tab's support reason in React (web §3.5; WEB-4 plan 2.4). `SupportReasonJanitor` (in the
// platform layout) removes every reason but the signed-in user's for the account the tab is on, on
// each route change, and all of them whenever the session ends (sign-out, idle expiry, a refused
// refresh, `token_invalid`, "another account"; adversary fix round 1, M); `SupportReasonProvider`
// (in the account layout) reads the user's reason for the one account from the tab's storage
// (never on the server, which has none) and sets it when the reason dialog is confirmed.
// Cross-tenant queries wait for `reason`.

// Who reads the stored reasons; told after every write or removal in this tab.
const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notify(): void {
  for (const listener of listeners) listener();
}

/** The signed-in staff member's id (the key of their reasons). */
function useUserId(): string {
  return useSession<PlatformMe>().user?.id ?? '';
}

/** Removes the reasons of the accounts (and users) the tab has left; all when the session ends. */
export function SupportReasonJanitor() {
  const pathname = usePathname();
  const userId = useUserId();
  useEffect(() => {
    const accountId = accountOfPath(pathname);
    keepOnly(window.sessionStorage, accountId === undefined ? undefined : { userId, accountId });
    notify();
  }, [pathname, userId]);
  const clear = useCallback(() => {
    keepOnly(window.sessionStorage, undefined);
    clearListReasons();
    notify();
  }, []);
  useSessionEndCleanup(clear);
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
  const userId = useUserId();
  // `undefined` on the server and during hydration (no storage there), `null` for no reason.
  const stored = useSyncExternalStore(
    subscribe,
    () => readReason(window.sessionStorage, { userId, accountId }) ?? null,
    () => undefined,
  );
  const setReason = useCallback(
    (reason: string) => {
      writeReason(window.sessionStorage, { userId, accountId }, reason);
      notify();
    },
    [userId, accountId],
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
