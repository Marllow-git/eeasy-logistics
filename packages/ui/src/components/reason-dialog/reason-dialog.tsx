'use client';

import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from '../../intl';
import { ConfirmDialog, type ConfirmDialogProps } from '../confirm-dialog/confirm-dialog';
import { Label } from '../label/label';

// The confirm of an action that must say why (WEB-4 plan 2.4; web §3.5): the console's support
// reason before the first cross-tenant read, and the body reasons of suspend, reactivate, close,
// a flag, a rollout mode, a replay and a factor reset. WEB-3's `ConfirmDialog` with a reason field:
// the confirm waits until the reason holds `min` characters (trimmed), the field takes at most
// `max` (200 for the `X-Support-Reason` header, 500 for a body reason: PLAT-13 8.2 #33), the count
// shows under it, and the confirm gets the trimmed reason with the intent's `Idempotency-Key`.

export interface ReasonDialogProps extends Omit<
  ConfirmDialogProps,
  'onConfirm' | 'confirmDisabled'
> {
  /** The longest reason the door takes. */
  readonly max: number;
  /** The shortest; 5 on every console door. */
  readonly min?: number;
  /** The tab's support reason, so an operator types it once (WEB-4 2a). */
  readonly initialReason?: string;
  /** The field's label; "Reason" by default. */
  readonly label?: ReactNode;
  /**
   * How the door measures the reason, when not in code points: the support header counts its
   * encoded form (8.2). The field then has no `maxLength` of its own.
   */
  readonly measure?: (reason: string) => number;
  /** More that must hold before the confirm (the account name typed to close). */
  readonly ready?: boolean;
  readonly onConfirm: (reason: string, idempotencyKey: string) => Promise<void>;
}

/** The length the doors count: code points of the trimmed text. */
export function reasonLength(text: string): number {
  return [...text.trim()].length;
}

export function ReasonDialog({
  max,
  min = 5,
  initialReason = '',
  label,
  ready = true,
  measure = reasonLength,
  onConfirm,
  children,
  ...dialog
}: ReasonDialogProps) {
  const t = useTranslations('common.reason');
  const id = useId();
  const [reason, setReason] = useState(initialReason);
  const length = measure(reason);
  const short = reasonLength(reason) < min;
  return (
    <ConfirmDialog
      {...dialog}
      confirmDisabled={short || length > max || !ready}
      onConfirm={(key) => onConfirm(reason.trim(), key)}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-reason`}>{label ?? t('label')}</Label>
        <textarea
          id={`${id}-reason`}
          dir="auto"
          rows={3}
          maxLength={measure === reasonLength ? max : undefined}
          required
          aria-describedby={`${id}-count`}
          aria-invalid={length > max || undefined}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <p id={`${id}-count`} className="text-xs text-muted-foreground">
          {short ? t('too_short', { min }) : null}
          {length > max ? t('too_long', { max }) : null}{' '}
          <span dir="ltr">{t('count', { count: length, max })}</span>
        </p>
      </div>
      {children}
    </ConfirmDialog>
  );
}
