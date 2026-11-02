'use client';

import { ApiError } from '@eeasy-logistics/contracts/http';
import { client, hooks } from '@eeasy-logistics/contracts/platform';
import { ConfirmDialog } from '@eeasy-logistics/ui/components/confirm-dialog';
import { Input } from '@eeasy-logistics/ui/components/input';
import { Label } from '@eeasy-logistics/ui/components/label';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { RolePicker, type StaffRole } from './staff-parts';

// Invite a platform staff member (WEB-4 plan 2.9; Toggl's role list): email, name and one role;
// `platformInviteStaff` mails the invitation (the person sets a password and enrols TOTP from it).
// An address that is already live staff answers `409 invalid_transition`, said in words.

const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteStaffDialog({
  superAdmin,
  onClose,
  onDone,
}: {
  superAdmin: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations('platform.staff.invite');
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  const id = useId();
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole | undefined>(undefined);
  const ready = email.test(address.trim()) && name.trim() !== '' && role !== undefined;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t('title')}
      description={t('description')}
      confirmLabel={t('submit')}
      tone="primary"
      confirmDisabled={!ready}
      describeError={(error) =>
        error instanceof ApiError && error.code === 'invalid_transition' ? t('already') : undefined
      }
      onConfirm={async (idempotencyKey) => {
        if (role === undefined) return;
        await client.platformInviteStaff(
          { email: address.trim(), name: name.trim(), roles: [role] },
          { fetcher, headers: { 'Idempotency-Key': idempotencyKey } },
        );
        await queryClient.invalidateQueries({
          queryKey: hooks.getPlatformListStaffUsersQueryKey(),
        });
        onDone(t('done', { email: address.trim() }));
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-email`}>{t('email')}</Label>
        <Input
          id={`${id}-email`}
          type="email"
          dir="ltr"
          autoComplete="off"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-name`}>{t('name')}</Label>
        <Input
          id={`${id}-name`}
          dir="auto"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <RolePicker value={role} onChange={setRole} superAdmin={superAdmin} label={t('role')} />
    </ConfirmDialog>
  );
}
