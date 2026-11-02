'use client';

import { Slot } from 'radix-ui';
import { useId, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/tooltip/tooltip';
import { useTranslations } from '../intl';
import { usePermissions } from '../session/session-provider';

// Controls gated by the session's permissions (web §4; WEB-3 plan 2.2). A convenience only: the
// API refuses every call the permission does not allow, so a hidden or disabled control is never
// the only barrier.

/** Whether the session holds `permission`. */
export function useCan(permission: string): boolean {
  return usePermissions().has(permission);
}

/**
 * The control itself, disabled with the reason as its description and in a tooltip. The tooltip
 * sits on a focusable wrapper: a disabled control takes no focus or pointer, so the reason is
 * reachable by keyboard and by hover alike.
 */
export function DisabledWithReason({
  reason,
  children,
}: {
  reason: ReactNode;
  children: ReactElement;
}) {
  const id = useId();
  // Slot merges these into the one child; `disabled` is not an HTMLElement attribute in its type.
  const disabled = { disabled: true, 'aria-describedby': id } as HTMLAttributes<HTMLElement>;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-md" data-disabled-reason="">
            <Slot.Root {...disabled}>{children}</Slot.Root>
          </span>
        </TooltipTrigger>
        <span id={id} className="sr-only">
          {reason}
        </span>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Renders `children` when the session holds `permission`. Otherwise nothing (`fallback` "hidden",
 * the default: the action means nothing to the role), or the control disabled with an explanation
 * (`fallback` "disabled": the user sees the object but may not act on it; `children` is then one
 * element that accepts `disabled`).
 */
export function Can({
  permission,
  fallback = 'hidden',
  reason,
  children,
}: {
  permission: string;
  fallback?: 'hidden' | 'disabled';
  /** The explanation of a disabled control; the generic "your role" line by default. */
  reason?: ReactNode;
  children: ReactElement;
}) {
  const allowed = useCan(permission);
  const t = useTranslations('common.authz');
  if (allowed) return children;
  if (fallback === 'hidden') return null;
  return <DisabledWithReason reason={reason ?? t('not_permitted')}>{children}</DisabledWithReason>;
}
