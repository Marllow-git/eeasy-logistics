'use client';

import { useEffect } from 'react';

/**
 * Throws after hydration, in the browser only, for the census (PLAT-14 plan 2.9). The message
 * carries the page URL (token segment, query string) so the census can check that the report
 * leaving through /monitoring has neither.
 */
export function ClientFault(): null {
  useEffect(() => {
    throw new Error(`Census fault in the browser at ${window.location.href}`);
  }, []);
  return null;
}
