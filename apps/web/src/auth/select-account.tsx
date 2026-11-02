'use client';

import { client } from '@eeasy-logistics/contracts/staff';
import { useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import { Button } from '@eeasy-logistics/ui/components/button';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  authFetcher,
  continueSignIn,
  factorRequired,
  stepStore,
  useStoredStep,
  type Selection,
} from './steps';

const roleKeys = [
  'owner',
  'admin',
  'dispatcher',
  'site_staff',
  'warehouse_staff',
  'cashier',
  'viewer',
] as const;

/**
 * `/sign-in/select-account` (WEB-2 plan 2.7; the Featurebase and Steep references): the accounts
 * of the user with their roles, one button each; a factor the chosen account requires goes to the
 * code page; "Use another email" starts over.
 */
export function SelectAccount() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const message = useErrorMessage();
  const router = useRouter();
  const raw = useStoredStep('selection');
  const selection = useMemo(() => {
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as Selection;
    } catch {
      return undefined;
    }
  }, [raw]);
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (selection === undefined && stepStore.selection() === undefined) router.replace('/sign-in');
  }, [selection, router]);

  if (selection === undefined) return null;

  const roleNames = (roles: readonly string[] | undefined) =>
    new Intl.ListFormat(locale, { type: 'conjunction' }).format(
      (roles ?? []).map((role) =>
        (roleKeys as readonly string[]).includes(role)
          ? t(`roles.${role as (typeof roleKeys)[number]}`)
          : role,
      ),
    );

  const choose = async (membershipId: string) => {
    setBusy(membershipId);
    setError(undefined);
    try {
      const answer = await client.selectAccount(
        { selection_token: selection.token, membership_id: membershipId },
        { fetcher: authFetcher() },
      );
      if (answer.status !== 200) throw new Error(`select answered ${answer.status}`);
      continueSignIn({ me: answer.data }, (path) => router.push(path));
    } catch (failure) {
      const factor = factorRequired(failure);
      if (factor !== undefined) {
        continueSignIn(factor, (path) => router.push(path));
        return;
      }
      setError(message(failure));
      setBusy(undefined);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {selection.memberships.map((membership) => (
          <li key={membership.membership_id}>
            <button
              type="button"
              disabled={busy !== undefined}
              onClick={() => {
                if (membership.membership_id !== undefined) void choose(membership.membership_id);
              }}
              className="flex w-full items-center gap-3 rounded-md border border-border p-4 text-start hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
            >
              <span className="flex flex-1 flex-col gap-1">
                <span dir="auto" className="font-semibold text-foreground">
                  {membership.account_name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('select_account.roles', { roles: roleNames(membership.roles) })}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button asChild variant="secondary">
        <Link href="/sign-in" onClick={stepStore.clear}>
          {t('select_account.other_email')}
        </Link>
      </Button>
    </div>
  );
}
