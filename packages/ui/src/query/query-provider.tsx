'use client';

import { ApiError } from '@eeasy-logistics/contracts/http';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSignOutCleanup } from '../session/session-provider';

// The browser's query cache of a signed-in group (web §2.2 to §2.4; WEB-3 plan 2.1). Generated
// TanStack Query hooks of packages/contracts run under it with the session fetcher. Tenant data is
// cached here only, never by Next or the edge (web §2.4).

/** `staleTime` per data class (web §2.4); lists pass `staleTimes.list`. */
export const staleTimes = {
  session: 5 * 60_000,
  reference: 5 * 60_000,
  list: 30_000,
} as const;

/**
 * A refusal that means the browser's view of the session is stale (web §4): `403 forbidden` or
 * `403 feature_not_enabled`. The page then reads `getMe` again (the server layout) so the
 * navigation and the controls follow the new permissions.
 */
export function isStaleSessionRefusal(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    (error.code === 'forbidden' || error.code === 'feature_not_enabled')
  );
}

/** A 4xx is an answer, not a fault: never retried. Network failures and 5xx get two retries. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/** The query client with the data-class defaults; `onStaleSession` hears a stale-session refusal. */
export function createQueryClient(onStaleSession?: (error: unknown) => void): QueryClient {
  const onError = (error: unknown) => {
    if (isStaleSessionRefusal(error)) onStaleSession?.(error);
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: staleTimes.reference,
        refetchOnWindowFocus: true,
        retry: shouldRetry,
      },
      // A write is retried only by the user, with the intent's Idempotency-Key (web §7.4).
      mutations: { retry: false },
    },
  });
}

/** Re-reading the session more often than this would only repeat the same answer. */
const sessionRereadInterval = 5_000;
/** The window event a stale-session refusal raises; the provider re-reads the session on it. */
const staleSessionEvent = 'elx:session-stale';

/**
 * The query cache of the page, inside `SessionProvider`: one client per page load; a stale-session
 * refusal refreshes the server layout (a new `getMe`, at most once in five seconds); sign-out
 * clears the cache before the page leaves (WEB-2 plan §8.2 #16).
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [client] = useState(() =>
    createQueryClient(() => window.dispatchEvent(new Event(staleSessionEvent))),
  );
  useEffect(() => {
    let last = 0;
    const reread = () => {
      const now = Date.now();
      if (now - last < sessionRereadInterval) return;
      last = now;
      router.refresh();
    };
    window.addEventListener(staleSessionEvent, reread);
    return () => window.removeEventListener(staleSessionEvent, reread);
  }, [router]);
  const clear = useCallback(() => client.clear(), [client]);
  useSignOutCleanup(clear);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
