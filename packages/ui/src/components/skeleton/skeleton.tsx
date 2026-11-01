import type { ComponentProps } from 'react';
import { cn } from '../../cn';

/** A loading placeholder; hidden from assistive technology, which hears the region's busy state. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
  );
}
