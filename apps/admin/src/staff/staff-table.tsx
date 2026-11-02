'use client';

import { client, hooks, type PlatformUser } from '@eeasy-logistics/contracts/platform';
import { Button } from '@eeasy-logistics/ui/components/button';
import { DateTime } from '@eeasy-logistics/ui/components/date-time';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@eeasy-logistics/ui/components/dropdown-menu';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { DataTable, type DataTableColumn } from '@eeasy-logistics/ui/table';
import { useCursorList } from '@eeasy-logistics/ui/table/cursor-list';
import { useMemo, useState } from 'react';
import { LoadError } from '../accounts/parts';
import { InviteStaffDialog } from './invite-staff';
import { StaffActionDialog, type StaffAction } from './staff-actions';
import { StaffRoleChip, roleOf, useCaller } from './staff-parts';

// The platform staff (web §8 wave 0; WEB-4 plan 2.9): `platformListStaffUsers` (a small list, up
// to 200 a page with "load more"), each with the role or "revoked", whether TOTP is enrolled, and
// when they joined; "Invite" in the header; per row a menu of the three actions. An action the
// rules refuse is shown disabled with why: never on oneself; the last super admin keeps the role;
// the reset is a super admin's. The API decides anyway (`403 forbidden` renders the catalogue).

const pageSize = 200;

type Refusal = 'self' | 'last_super_admin' | 'super_admin_only' | 'revoked';

function ActionItem({
  label,
  refusal,
  onSelect,
}: {
  label: string;
  refusal: Refusal | undefined;
  onSelect: () => void;
}) {
  const t = useTranslations('platform.staff.locks');
  return (
    <DropdownMenuItem disabled={refusal !== undefined} onSelect={onSelect}>
      <span className="flex flex-col">
        <span>{label}</span>
        {refusal === undefined ? null : (
          <span className="text-xs text-muted-foreground">{t(refusal)}</span>
        )}
      </span>
    </DropdownMenuItem>
  );
}

export function StaffTable() {
  const t = useTranslations('platform.staff');
  const fetcher = useSessionFetcher();
  const caller = useCaller();
  const [inviting, setInviting] = useState(false);
  const [acting, setActing] = useState<{ action: StaffAction; user: PlatformUser } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const list = useCursorList<PlatformUser>({
    queryKey: hooks.getPlatformListStaffUsersQueryKey(),
    fetchPage: async (cursor, signal) => {
      const answer = await client.platformListStaffUsers(
        { cursor, limit: pageSize },
        { fetcher, signal },
      );
      return answer.data as { data: PlatformUser[]; next_cursor: string | null };
    },
  });
  const liveSuperAdmins = list.rows.filter(
    (user) => roleOf(user) === 'platform_super_admin',
  ).length;

  const columns = useMemo<DataTableColumn<PlatformUser>[]>(
    () => [
      {
        id: 'name',
        header: t('columns.name'),
        cell: (user) => (
          <div className="flex min-w-0 flex-col">
            <span dir="auto" className="font-semibold text-foreground">
              {user.name}
              {user.id === caller.id ? (
                <span className="ms-2 text-xs font-normal text-muted-foreground">{t('you')}</span>
              ) : null}
            </span>
            {user.email ? (
              <bdi dir="ltr" className="self-start text-xs text-muted-foreground">
                {user.email}
              </bdi>
            ) : null}
          </div>
        ),
      },
      { id: 'role', header: t('columns.role'), cell: (user) => <StaffRoleChip user={user} /> },
      {
        id: 'totp',
        header: t('columns.totp'),
        cell: (user) =>
          user.totp_enrolled ? (
            <span className="text-foreground">{t('totp_on')}</span>
          ) : (
            <span className="text-muted-foreground">{t('totp_off')}</span>
          ),
      },
      {
        id: 'created',
        header: t('columns.created'),
        className: 'whitespace-nowrap',
        cell: (user) => <DateTime value={user.created_at} dateStyle="medium" />,
      },
    ],
    [t, caller.id],
  );

  const refusals = (user: PlatformUser) => {
    const self = user.id === caller.id;
    const role = roleOf(user);
    const lastSuperAdmin = role === 'platform_super_admin' && liveSuperAdmins <= 1;
    const touchesSuperAdmin = role === 'platform_super_admin' && !caller.superAdmin;
    const change: Refusal | undefined = self
      ? 'self'
      : lastSuperAdmin
        ? 'last_super_admin'
        : touchesSuperAdmin
          ? 'super_admin_only'
          : undefined;
    return {
      role: change,
      revoke: role === undefined ? ('revoked' as const) : change,
      reset: self
        ? ('self' as const)
        : !caller.superAdmin
          ? ('super_admin_only' as const)
          : role === undefined
            ? ('revoked' as const)
            : undefined,
    };
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-foreground empty:hidden">
          {done}
        </p>
        <Button className="ms-auto" onClick={() => setInviting(true)}>
          {t('invite.button')}
        </Button>
      </div>
      <DataTable
        id="platform-staff"
        label={t('table_label')}
        columns={columns}
        rows={list.rows}
        rowKey={(user) => user.id}
        state={list.state}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        rowActions={(user) => {
          const locked = refusals(user);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('actions_for', { name: user.name ?? user.email ?? '' })}
                >
                  {t('actions')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <ActionItem
                  label={t('role.button')}
                  refusal={locked.role}
                  onSelect={() => setActing({ action: 'role', user })}
                />
                <ActionItem
                  label={t('revoke.button')}
                  refusal={locked.revoke}
                  onSelect={() => setActing({ action: 'revoke', user })}
                />
                <ActionItem
                  label={t('reset.button')}
                  refusal={locked.reset}
                  onSelect={() => setActing({ action: 'reset', user })}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }}
        empty={<p className="text-sm text-muted-foreground">{t('empty')}</p>}
        error={<LoadError error={list.error} onRetry={list.retry} />}
      />
      {inviting ? (
        <InviteStaffDialog
          superAdmin={caller.superAdmin}
          onClose={() => setInviting(false)}
          onDone={(message) => {
            setInviting(false);
            setDone(message);
          }}
        />
      ) : null}
      {acting === null ? null : (
        <StaffActionDialog
          action={acting.action}
          user={acting.user}
          superAdmin={caller.superAdmin}
          onClose={() => setActing(null)}
          onDone={(message) => {
            setActing(null);
            setDone(message);
          }}
        />
      )}
    </>
  );
}
