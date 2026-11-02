'use client';

import { ChevronDown, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/button/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/dropdown-menu/dropdown-menu';
import { useTranslations } from '../intl';
import { useSession, useSignOut } from './session-provider';

/**
 * The top bar's user slot (WEB-2 plan 2.3): the user's name and the account's, and "Sign out".
 * "Switch account" is not offered: `Me` carries no list of memberships to switch to (§8.2).
 * Names are user data: `dir="auto"` (web §5).
 */
export function UserMenu() {
  const me = useSession();
  const signOut = useSignOut();
  const t = useTranslations('auth.session');
  const [leaving, setLeaving] = useState(false);
  const name = me.user?.name ?? '';
  const account = me.account?.name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${t('user_menu')}: ${name}`}>
          <span dir="auto" className="max-w-40 truncate">
            {name}
          </span>
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span dir="auto" className="block truncate">
            {name}
          </span>
          {account === undefined ? null : (
            <span dir="auto" className="block truncate text-xs font-normal text-muted-foreground">
              {account}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={leaving}
          onSelect={() => {
            setLeaving(true);
            void signOut();
          }}
        >
          <LogOut aria-hidden className="size-4 rtl:-scale-x-100" />
          {leaving ? t('signing_out') : t('sign_out')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
