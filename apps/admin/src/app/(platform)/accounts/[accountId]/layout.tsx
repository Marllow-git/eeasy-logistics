import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccountFrame } from '../../../../accounts/account-frame';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Acting on one account (web §3.5; WEB-4 plan 2.4): the frame asks the support reason, then shows
 * the banner, the header and the tabs. Everything under it reads in the browser, where the tab's
 * reason is (the server never holds it). The parent layout gates `platform.accounts.read`.
 */
export default async function AccountLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  if (!uuid.test(accountId)) notFound();
  return <AccountFrame accountId={accountId.toLowerCase()}>{children}</AccountFrame>;
}
