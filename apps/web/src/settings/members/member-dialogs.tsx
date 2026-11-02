'use client';

import { client, hooks, schemas, type Membership } from '@eeasy-logistics/contracts/staff';
import { ConfirmDialog } from '@eeasy-logistics/ui/components/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@eeasy-logistics/ui/components/dialog';
import { Form, SubmitButton, useContractForm } from '@eeasy-logistics/ui/form';
import { TextAreaField } from '@eeasy-logistics/ui/form/fields';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { memberQueryRoot } from './member-keys';

// The member's destructive actions (WEB-3 plan 2.7; design references: Jobber's and Square's
// revoke dialog with what happens as a list, Calendly's and 7shifts' reason on the confirm): each
// write carries the intent's key, refreshes the member and every members list, and reports done
// through `onDone`. Loaded with `next/dynamic` on first open.

function useMemberRefresh(id: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: hooks.getGetMemberQueryKey(id) }),
      queryClient.invalidateQueries({ queryKey: [memberQueryRoot] }),
    ]);
  };
}

/** Revokes an active membership, or withdraws a pending invitation (the same door). */
export function RevokeDialog({
  member,
  open,
  onOpenChange,
  onDone,
}: {
  member: Membership;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations('settings.members.revoke');
  const fetcher = useSessionFetcher();
  const refresh = useMemberRefresh(member.id);
  const name = member.user?.name ?? '';
  const invited = member.status === 'invited';
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={invited ? t('withdraw_title', { name }) : t('title', { name })}
      consequences={
        invited
          ? [t('withdraw_consequence')]
          : [t('consequence_sessions'), t('consequence_audit'), t('consequence_return')]
      }
      confirmLabel={invited ? t('withdraw_confirm') : t('confirm')}
      onConfirm={async (idempotencyKey) => {
        await client.revokeMember(member.id, {
          fetcher,
          headers: { 'Idempotency-Key': idempotencyKey },
        });
        await refresh();
        onDone(invited ? t('withdrawn') : t('done'));
      }}
    />
  );
}

const resetSchema = schemas.ResetMemberSecondFactorBody;

/** Clears the member's second factor with a reason; the member gets a re-enrolment link. */
export function ResetFactorDialog({
  member,
  open,
  onOpenChange,
  onDone,
}: {
  member: Membership;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations('settings.members.reset');
  const fetcher = useSessionFetcher();
  const refresh = useMemberRefresh(member.id);
  const form = useContractForm(resetSchema, { reason: '' });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('title', { name: member.user?.name ?? '' })}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
          <li>{t('consequence_phone')}</li>
          <li>{t('consequence_link')}</li>
        </ul>
        <Form
          form={form}
          onSubmit={async (values, { idempotencyKey }) => {
            await client.resetMemberSecondFactor(member.id, values, {
              fetcher,
              headers: { 'Idempotency-Key': idempotencyKey },
            });
            await refresh();
            onDone(t('done'));
            onOpenChange(false);
          }}
        >
          <TextAreaField<typeof resetSchema._input, 'reason'>
            name="reason"
            label={t('reason')}
            description={t('reason_hint')}
            maxLength={500}
          />
          <SubmitButton variant="danger">{t('submit')}</SubmitButton>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
