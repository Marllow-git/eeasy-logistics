'use client';

import { client, type Account } from '@eeasy-logistics/contracts/platform';
import { Can } from '@eeasy-logistics/ui/authz';
import { Button } from '@eeasy-logistics/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@eeasy-logistics/ui/components/dialog';
import { Form, SubmitButton, useContractForm } from '@eeasy-logistics/ui/form';
import { TextField } from '@eeasy-logistics/ui/form/fields';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useState } from 'react';
import { useSupportReason } from '../support/support-reason';
import { inviteOwnerSchema } from './account-schemas';
import { isolate, isStale } from './parts';

// "Invite owner" (WEB-4 plan 2.5; PLAT-13 2.4): `platformInviteOwner` re-invites or adds an owner
// by email; an account may have several. An address that is already an active owner answers
// `409 invalid_transition`, which the dialog says in words. For `platform.accounts.provision`.

type Values = typeof inviteOwnerSchema._input;

function InviteDialog({
  account,
  onOpenChange,
  onSent,
}: {
  account: Account;
  onOpenChange: (open: boolean) => void;
  onSent: (email: string) => void;
}) {
  const t = useTranslations('platform');
  const fetcher = useSessionFetcher();
  const { headers } = useSupportReason();
  const form = useContractForm(inviteOwnerSchema, { email: '', name: '' });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('account.invite.title')}</DialogTitle>
        <DialogDescription>{t('account.invite.description')}</DialogDescription>
        <Form
          form={form}
          describeError={(error) =>
            isStale(error) ? t('account.invite.already_active') : undefined
          }
          onSubmit={async (values, { idempotencyKey }) => {
            await client.platformInviteOwner(account.id, values, {
              fetcher,
              headers: { ...headers, 'Idempotency-Key': idempotencyKey },
            });
            onSent(values.email);
          }}
        >
          <TextField<Values, 'email'>
            name="email"
            type="email"
            label={t('provision.fields.owner_email')}
            input={{ dir: 'ltr', autoComplete: 'off' }}
          />
          <TextField<Values, 'name'>
            name="name"
            label={t('provision.fields.owner_name')}
            input={{ dir: 'auto', autoComplete: 'off' }}
          />
          <SubmitButton>{t('account.invite.submit')}</SubmitButton>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function InviteOwner({ account }: { account: Account }) {
  const t = useTranslations('platform');
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  if (account.status === 'closed') return null;
  return (
    <Can permission="platform.accounts.provision">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t('account.invite.button')}
        </Button>
        <p role="status" className="text-sm text-foreground empty:hidden">
          {sent}
        </p>
        {open ? (
          <InviteDialog
            account={account}
            onOpenChange={setOpen}
            onSent={(email) => {
              setOpen(false);
              setSent(t('account.invite.sent', { email: isolate(email) }));
            }}
          />
        ) : null}
      </div>
    </Can>
  );
}
