'use client';

import type { PlatformMe, PlatformUser } from '@eeasy-logistics/contracts/platform';
import { Badge } from '@eeasy-logistics/ui/components/badge';
import { Label } from '@eeasy-logistics/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@eeasy-logistics/ui/components/radio-group';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useSession } from '@eeasy-logistics/ui/session';
import { useId } from 'react';

// The platform staff's shared pieces (WEB-4 plan 2.9; design reference: Toggl's role list with one
// sentence per role): the role chip ("revoked" for a row without a role), the role picker, and who
// the caller is. `super_admin` is offered to a super admin only (PLAT-13 2.9: super-admin rights
// come only from a super admin); the API refuses anyway.

export const staffRoles = ['platform_super_admin', 'platform_admin', 'platform_support'] as const;
export type StaffRole = (typeof staffRoles)[number];

/** The staff member's live role, or undefined for a revoked row. */
export function roleOf(user: PlatformUser): StaffRole | undefined {
  const role = user.roles?.[0];
  return staffRoles.includes(role as StaffRole) ? role : undefined;
}

export function StaffRoleChip({ user }: { user: PlatformUser }) {
  const t = useTranslations('platform.staff');
  const role = roleOf(user);
  if (role === undefined) return <Badge tone="neutral">{t('revoked')}</Badge>;
  return (
    <Badge tone={role === 'platform_super_admin' ? 'primary' : 'neutral'}>
      {t(`roles.${role}.label`)}
    </Badge>
  );
}

/** The signed-in staff member: their id and whether they are a super admin. */
export function useCaller(): { id: string | undefined; superAdmin: boolean } {
  const me = useSession<PlatformMe>();
  return {
    id: me.user?.id,
    superAdmin: (me.user?.roles ?? []).includes('platform_super_admin'),
  };
}

export function RolePicker({
  value,
  onChange,
  superAdmin,
  label,
}: {
  value: StaffRole | undefined;
  onChange: (role: StaffRole) => void;
  /** The caller is a super admin: `super_admin` is offered. */
  superAdmin: boolean;
  label: string;
}) {
  const t = useTranslations('platform.staff.roles');
  const id = useId();
  const offered = staffRoles.filter((role) => superAdmin || role !== 'platform_super_admin');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-foreground">{label}</legend>
      <RadioGroup value={value ?? ''} onValueChange={(next) => onChange(next as StaffRole)}>
        {offered.map((role) => (
          <div key={role} className="flex items-start gap-3">
            <RadioGroupItem
              id={`${id}-${role}`}
              value={role}
              aria-describedby={`${id}-${role}-hint`}
              className="mt-1"
            />
            <div className="flex flex-col">
              <Label htmlFor={`${id}-${role}`}>{t(`${role}.label`)}</Label>
              <p id={`${id}-${role}-hint`} className="text-xs text-muted-foreground">
                {t(`${role}.sentence`)}
              </p>
            </div>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
