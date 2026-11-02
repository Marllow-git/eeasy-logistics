'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

// A list's filters, sort and selected site live in the URL search parameters (web §2.4; WEB-3
// plan 2.4), so a list view is shareable and the back button restores it; a change replaces the
// history entry rather than adding one, and the query key is built from the same values.

export type ListParams<Key extends string> = { readonly [K in Key]: string | undefined };

/** The URL query of `params`: empty values dropped, keys in a stable order. */
export function listQuery<Key extends string>(params: Partial<ListParams<Key>>): string {
  const query = new URLSearchParams();
  for (const key of Object.keys(params).sort() as Key[]) {
    const value = params[key];
    if (value !== undefined && value !== '') query.set(key, value);
  }
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * The list parameters `keys` of the current URL, and `set` to change some of them (an empty or
 * undefined value removes one). Parameters other than `keys` are kept.
 */
export function useListParams<Key extends string>(
  keys: readonly Key[],
): { params: ListParams<Key>; set: (changes: Partial<ListParams<Key>>) => void } {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const signature = keys.join(',');
  const params = useMemo(() => {
    const values = {} as Record<Key, string | undefined>;
    for (const key of signature.split(',') as Key[]) values[key] = search.get(key) ?? undefined;
    return values;
  }, [search, signature]);
  const set = useCallback(
    (changes: Partial<ListParams<Key>>) => {
      const next = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(changes) as [Key, string | undefined][]) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      const text = next.toString();
      router.replace(text === '' ? pathname : `${pathname}?${text}`, { scroll: false });
    },
    [search, pathname, router],
  );
  return { params, set };
}
