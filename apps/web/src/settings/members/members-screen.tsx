'use client';

import { Can } from '@eeasy-logistics/ui/authz';
import { Button } from '@eeasy-logistics/ui/components/button';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { isolate } from '../bidi';
import type { SiteOption } from '../site-options';

// The members page (WEB-3 plan 2.7): the header with "Invite member" for `core.members.manage`
// (hidden for the others: a viewer sees the list without a write control), the list, and the
// invite dialog. The table and the dialog load with `next/dynamic` (the dialog on first open), so
// the route's first load stays inside the merchant budget (WEB-3 leg 1, 8.3 #3).

const MembersTable = dynamic(
  () => import('./members-table').then((module) => module.MembersTable),
  { loading: () => <Skeleton className="h-64 w-full" /> },
);
const InviteDialog = dynamic(
  () => import('./invite-dialog').then((module) => module.InviteDialog),
  { ssr: false },
);

export function MembersScreen({ title, sites }: { title: string; sites: readonly SiteOption[] }) {
  const t = useTranslations('settings.members');
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title={title}
        description={t('description')}
        actions={
          <Can permission="core.members.manage">
            <Button onClick={() => setInviting(true)}>{t('invite')}</Button>
          </Can>
        }
      />
      <p role="status" className="mb-4 text-sm text-foreground empty:hidden">
        {notice}
      </p>
      <MembersTable sites={sites} />
      {inviting ? (
        <InviteDialog
          open
          onOpenChange={setInviting}
          sites={sites}
          onInvited={(email) => {
            setInviting(false);
            setNotice(t('invited_notice', { email: isolate(email) }));
          }}
        />
      ) : null}
    </>
  );
}
