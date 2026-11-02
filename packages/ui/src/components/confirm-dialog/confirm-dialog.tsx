'use client';

import { AlertDialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { useErrorMessage } from '../../auth/error-message';
import { cn } from '../../cn';
import { useIntentKey } from '../../form/intent-key';
import { useTranslations } from '../../intl';
import { buttonVariants } from '../button/button';

// The confirmation of a destructive or state-changing action (web §7.4; design references,
// docs/references/design/WEB-3.md "Member detail and edit, revoke" and "Sites": Jobber, Square,
// Workable): an alert dialog naming the object, the consequences as a list, Cancel and one
// confirm button. The confirm waits for the write with the dialog open and busy, keeps the
// intent's `Idempotency-Key` across retries, and shows a refusal inside the dialog.

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** What the action does, one line each (what stops, what is kept). */
  readonly consequences?: readonly ReactNode[];
  readonly confirmLabel: ReactNode;
  /** `danger` for what takes something away (revoke, deactivate); `primary` otherwise. */
  readonly tone?: 'danger' | 'primary';
  /** The write; receives the intent's key. A rejection keeps the dialog open with the reason. */
  readonly onConfirm: (idempotencyKey: string) => Promise<void>;
  /** A page's own text for some refusals (the reasons of `site_in_use`); the catalogue otherwise. */
  readonly describeError?: (error: unknown) => ReactNode | undefined;
  readonly children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  consequences = [],
  confirmLabel,
  tone = 'danger',
  onConfirm,
  describeError,
  children,
}: ConfirmDialogProps) {
  const t = useTranslations('common');
  const errorMessage = useErrorMessage();
  const intent = useIntentKey();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReactNode>(null);

  const change = (next: boolean) => {
    if (busy) return;
    if (!next) setFailure(null);
    onOpenChange(next);
  };

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await onConfirm(intent.key);
      intent.renew();
      setBusy(false);
      onOpenChange(false);
    } catch (error) {
      setBusy(false);
      setFailure(describeError?.(error) ?? errorMessage(error));
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={change}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <AlertDialog.Content
          aria-busy={busy}
          className="fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col gap-4 overflow-y-auto rounded-lg bg-background p-6 text-foreground shadow-lg"
        >
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          {description ? (
            <AlertDialog.Description className="text-sm text-muted-foreground">
              {description}
            </AlertDialog.Description>
          ) : null}
          {consequences.length > 0 ? (
            <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-foreground">
              {consequences.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : null}
          {children}
          {failure !== null ? (
            <div role="alert" className="text-sm text-danger">
              {failure}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel
              disabled={busy}
              className={buttonVariants({ variant: 'secondary' })}
            >
              {t('actions.cancel')}
            </AlertDialog.Cancel>
            <button
              type="button"
              disabled={busy}
              aria-busy={busy}
              className={cn(buttonVariants({ variant: tone }))}
              onClick={() => void confirm()}
            >
              {busy ? t('form.saving') : confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
