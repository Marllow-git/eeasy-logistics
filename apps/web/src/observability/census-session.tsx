'use client';

import { client } from '@eeasy-logistics/contracts/staff';
import { useSessionFetcher, useUnsavedState } from '@eeasy-logistics/ui/session';
import { useState } from 'react';

/**
 * The census's in-page session probe (WEB-2 plan 2.14): two concurrent `getMe` calls through the
 * page's session fetcher, so the census can prove one refresh per browser for two
 * `401 token_expired` answers, and with `?unsaved` a registered unsaved state, so it can prove the
 * re-sign-in dialog. Rendered only in local and ci builds (census-session/page.tsx).
 */
export function CensusSession({ unsaved }: { unsaved: boolean }) {
  const fetcher = useSessionFetcher();
  const [statuses, setStatuses] = useState<string>('idle');
  useUnsavedState(unsaved);
  return (
    <div className="flex flex-col gap-2 p-4">
      <button
        type="button"
        className="self-start rounded-md border border-input px-3 py-2"
        onClick={() => {
          setStatuses('running');
          const call = () =>
            client.getMe({ fetcher }).then(
              (answer) => String(answer.status),
              (error: unknown) => (error instanceof Error ? error.name : 'error'),
            );
          void Promise.all([call(), call()]).then((results) => setStatuses(results.join(',')));
        }}
      >
        census: two calls
      </button>
      <output data-testid="census-session-result">{statuses}</output>
    </div>
  );
}
