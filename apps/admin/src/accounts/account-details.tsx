'use client';

import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { accountOf, useAccount } from './account-frame';
import { takeNotice } from './notice';

// The account's Details tab (WEB-4 plan 2.5): the details form on `platformUpdateAccount` (name,
// language, the four limits with the current usage beside each; a PATCH of the changed fields)
// for `platform.accounts.provision`, read-only for the others; "Invite owner"; the lifecycle
// actions. Each loads as its own chunk (`next/dynamic`), so the account route's first load stays
// inside the budget; nothing renders before the support reason anyway.

const DetailsForm = dynamic(() => import('./details-form').then((module) => module.DetailsForm), {
  ssr: false,
  loading: () => <Skeleton className="h-96 w-full" />,
});
const InviteOwner = dynamic(() => import('./invite-owner').then((module) => module.InviteOwner), {
  ssr: false,
});
const Lifecycle = dynamic(() => import('./lifecycle').then((module) => module.Lifecycle), {
  ssr: false,
});

export function AccountDetails({ accountId }: { accountId: string }) {
  const account = accountOf(useAccount(accountId));
  const [notice] = useState(() => takeNotice(accountId));
  if (account === undefined) return null;
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="text-sm text-foreground empty:hidden">
        {notice}
      </p>
      <DetailsForm key={account.updated_at ?? account.id} account={account} />
      <InviteOwner account={account} />
      <Lifecycle account={account} />
    </div>
  );
}
