'use client';

import { Direction } from 'radix-ui';
import type { ReactNode } from 'react';

/**
 * Radix direction for every primitive below it (web §5): keyboard arrows, menu sides and slider
 * directions follow `dir`. Each root layout renders it with the request locale's direction.
 */
export function DirectionProvider({ dir, children }: { dir: 'rtl' | 'ltr'; children: ReactNode }) {
  return <Direction.Provider dir={dir}>{children}</Direction.Provider>;
}
