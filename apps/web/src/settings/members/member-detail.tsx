'use client';

import { hooks, type Me } from '@eeasy-logistics/contracts/staff';
import { roleBundles, type RoleKey } from '@eeasy-logistics/contracts/unions';
import { formatDateTime } from '@eeasy-logistics/i18n';
import { DisabledWithReason, useCan } from '@eeasy-logistics/ui/authz';
import { Button } from '@eeasy-logistics/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@eeasy-logistics/ui/components/card';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSession, useSessionFetcher } from '@eeasy-logistics/ui/session';
import { MemberStatusChip, RoleChip } from '@eeasy-logistics/ui/settings/status-chips';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { ListError } from '../list-error';
import { isolate } from '../bidi';
import { siteName, type SiteOption } from '../site-options';
import { memberLock, ownerRoleLock } from './member-rules';

// One member (WEB-3 plan 2.7; design references: Square's panel with the invitation banner on top
// and the actions apart from the edit, Jobber's revoke): the person, the roles and sites (an edit
// form for `core.members.manage`), and revoke and the second-factor reset. The member is read on
// the server and hydrated (`getMember`); writes refresh it. The form and the dialogs load with
// `next/dynamic`: the page's first load carries neither react-hook-form nor the schemas.

const MemberAccessForm = dynamic(
  () => import('./member-access-form').then((module) => module.MemberAccessForm),
  { ssr: false, loading: () => <Skeleton className="h-48 w-full" /> },
);
const RevokeDialog = dynamic(
  () => import('./member-dialogs').then((module) => module.RevokeDialog),
  { ssr: false },
);
const ResetFactorDialog = dynamic(
  () => import('./member-dialogs').then((module) => module.ResetFactorDialog),
  { ssr: false },
);

type Dialog = 'revoke' | 'reset' | null;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function MemberDetail({
  membershipId,
  sites,
  onlyActiveOwner,
}: {
  membershipId: string;
  sites: readonly SiteOption[];
  onlyActiveOwner: boolean;
}) {
  const t = useTranslations('settings');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const manage = useCan('core.members.manage');
  const me = useSession<Me>();
  const query = hooks.useGetMember(membershipId, { request: { fetcher } });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const accessId = useId();
  const member = query.data?.status === 200 ? query.data.data : undefined;

  if (member === undefined) {
    return query.isError ? (
      <ListError error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }

  const caller = { membershipId: me.membership?.id, roles: me.membership?.roles ?? [] };
  const target = { id: member.id, roles: member.roles ?? [], status: member.status };
  const lock = memberLock(caller, target);
  const ownerLock = ownerRoleLock(caller, target, onlyActiveOwner);
  const name = member.user?.name ?? '';
  const revoked = member.status === 'revoked';
  const scoped = (member.roles ?? []).some(
    (role) => roleBundles[role as RoleKey]?.siteScoped === true,
  );
  const memberSites = sites.filter((site) => member.site_ids?.includes(site.id));
  const lockReason = lock === undefined ? undefined : t(`members.locks.${lock}`);

  const action = (kind: Exclude<Dialog, null>, label: string) => {
    const button = (
      <Button variant="danger" onClick={() => setDialog(kind)}>
        {label}
      </Button>
    );
    return lockReason === undefined ? (
      button
    ) : (
      <DisabledWithReason reason={lockReason}>{button}</DisabledWithReason>
    );
  };

  const actions =
    manage && !revoked ? (
      <>
        {member.status === 'active' && member.user?.second_factor_enabled === true
          ? action('reset', t('members.reset.action'))
          : null}
        {action(
          'revoke',
          member.status === 'invited'
            ? t('members.revoke.withdraw_action')
            : t('members.revoke.action'),
        )}
      </>
    ) : null;

  return (
    <>
      <Link
        href="/settings/members"
        className="mb-3 inline-block text-sm text-muted-foreground hover:underline"
      >
        {t('members.detail.back')}
      </Link>
      <PageHeader
        title={<span dir="auto">{name}</span>}
        description={<span dir="ltr">{member.user?.email}</span>}
        actions={actions}
      />
      <p role="status" className="mb-4 text-sm text-foreground empty:hidden">
        {notice}
      </p>
      {member.status === 'invited' ? (
        <p role="note" className="mb-6 rounded-md border border-border bg-muted px-4 py-3 text-sm">
          {t('members.detail.invitation_banner', { email: isolate(member.user?.email ?? '') })}
        </p>
      ) : null}
      {revoked ? (
        <p role="note" className="mb-6 rounded-md border border-border bg-muted px-4 py-3 text-sm">
          {t('members.detail.revoked_banner')}
        </p>
      ) : null}
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('members.detail.profile_title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label={t('members.columns.status')}>
                <MemberStatusChip status={member.status} />
              </Fact>
              <Fact label={t('members.detail.email')}>
                <span dir="ltr">{member.user?.email}</span>
              </Fact>
              <Fact label={t('members.detail.joined')}>
                {member.created_at ? (
                  <time dateTime={member.created_at}>
                    {formatDateTime(locale, member.created_at, { dateStyle: 'medium' })}
                  </time>
                ) : null}
              </Fact>
              <Fact label={t('members.detail.second_factor')}>
                {member.user?.second_factor_enabled === true
                  ? t('members.detail.second_factor_on')
                  : t('members.detail.second_factor_off')}
              </Fact>
            </dl>
          </CardContent>
        </Card>
        <Card aria-labelledby={accessId}>
          <CardHeader>
            <CardTitle id={accessId}>{t('members.detail.access_title')}</CardTitle>
            {manage && !revoked ? (
              <p className="text-sm text-muted-foreground">
                {t('members.detail.access_description')}
              </p>
            ) : null}
          </CardHeader>
          <CardContent>
            {manage && !revoked ? (
              <MemberAccessForm member={member} sites={sites} lock={lock} ownerLock={ownerLock} />
            ) : (
              <dl className="flex flex-col gap-4">
                <Fact label={t('members.detail.roles')}>
                  <span className="flex flex-wrap gap-1">
                    {(member.roles ?? []).map((role) => (
                      <RoleChip key={role} role={role} />
                    ))}
                  </span>
                </Fact>
                <Fact label={t('members.detail.sites')}>
                  {!scoped
                    ? t('members.sites_all')
                    : memberSites.length === 0
                      ? t('members.sites_none')
                      : memberSites
                          .map((site) => siteName(site, locale))
                          .join(locale === 'ar' ? '، ' : ', ')}
                </Fact>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>
      {dialog === 'revoke' ? (
        <RevokeDialog
          member={member}
          open
          onOpenChange={(open) => setDialog(open ? 'revoke' : null)}
          onDone={setNotice}
        />
      ) : null}
      {dialog === 'reset' ? (
        <ResetFactorDialog
          member={member}
          open
          onOpenChange={(open) => setDialog(open ? 'reset' : null)}
          onDone={setNotice}
        />
      ) : null}
    </>
  );
}
