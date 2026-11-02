'use client';

import { client, hooks, type PlatformUser } from '@eeasy-logistics/contracts/platform';
import { ConfirmDialog } from '@eeasy-logistics/ui/components/confirm-dialog';
import { ReasonDialog } from '@eeasy-logistics/ui/components/reason-dialog';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { bodyReasonMax } from '../support/reason-store';
import { RolePicker, roleOf, type StaffRole } from './staff-parts';

// The three staff actions (WEB-4 plan 2.9; design references: Uxcel's role-change confirm that
// names the new power, hilos' and Grok's removal confirms that name the person, the consequence
// and the way back; Klaviyo's "what happens at their next sign-in"). Every one ends the person's
// sessions (PLAT-13 M-1); none is one click. The TOTP reset takes a reason (5 to 500); the role
// change and the revocation take none (the contract has none: §7 #3).

export type StaffAction = 'role' | 'revoke' | 'reset';

const staffListKey = () => hooks.getPlatformListStaffUsersQueryKey();

export function StaffActionDialog({
  action,
  user,
  superAdmin,
  onClose,
  onDone,
}: {
  action: StaffAction;
  user: PlatformUser;
  superAdmin: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations('platform.staff');
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  const current = roleOf(user);
  const [role, setRole] = useState<StaffRole | undefined>(current);
  const name = user.name ?? user.email ?? '';
  const refresh = () => queryClient.invalidateQueries({ queryKey: staffListKey() });
  const setRoles = async (roles: StaffRole[], idempotencyKey: string) => {
    await client.platformSetStaffRoles(
      user.id,
      { roles },
      { fetcher, headers: { 'Idempotency-Key': idempotencyKey } },
    );
    await refresh();
  };
  const open = (next: boolean) => {
    if (!next) onClose();
  };

  if (action === 'reset') {
    return (
      <ReasonDialog
        open
        onOpenChange={open}
        title={t('reset.title', { name })}
        description={t('reset.description')}
        consequences={[t('reset.link'), t('reset.sessions')]}
        confirmLabel={t('reset.confirm')}
        tone="danger"
        max={bodyReasonMax}
        onConfirm={async (reason, idempotencyKey) => {
          await client.platformResetStaffTotp(
            user.id,
            { reason },
            { fetcher, headers: { 'Idempotency-Key': idempotencyKey } },
          );
          await refresh();
          onDone(t('reset.done', { name }));
        }}
      />
    );
  }
  if (action === 'revoke') {
    return (
      <ConfirmDialog
        open
        onOpenChange={open}
        title={t('revoke.title', { name })}
        consequences={[t('revoke.sessions'), t('revoke.again')]}
        confirmLabel={t('revoke.confirm')}
        tone="danger"
        onConfirm={async (idempotencyKey) => {
          await setRoles([], idempotencyKey);
          onDone(t('revoke.done', { name }));
        }}
      />
    );
  }
  return (
    <ConfirmDialog
      open
      onOpenChange={open}
      title={t('role.title', { name })}
      consequences={[
        role === undefined ? t('role.pick') : t(`roles.${role}.sentence`),
        t('role.sessions'),
      ]}
      confirmLabel={t('role.confirm')}
      tone="primary"
      confirmDisabled={role === undefined || role === current}
      onConfirm={async (idempotencyKey) => {
        if (role === undefined) return;
        await setRoles([role], idempotencyKey);
        onDone(t('role.done', { name, role: t(`roles.${role}.label`) }));
      }}
    >
      <RolePicker value={role} onChange={setRole} superAdmin={superAdmin} label={t('role.label')} />
    </ConfirmDialog>
  );
}
