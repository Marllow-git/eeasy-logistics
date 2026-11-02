'use client';

import { client, hooks, schemas, type Membership } from '@eeasy-logistics/contracts/staff';
import { DisabledWithReason } from '@eeasy-logistics/ui/authz';
import { Button } from '@eeasy-logistics/ui/components/button';
import { Form, SubmitButton, useContractForm } from '@eeasy-logistics/ui/form';
import { CheckboxGroupField } from '@eeasy-logistics/ui/form/fields';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { siteName, type SiteOption } from '../site-options';
import { memberQueryRoot } from './member-keys';
import { staffRoles } from './member-roles';
import type { MemberLock, OwnerRoleLock } from './member-rules';

// The roles and sites of a member (WEB-3 plan 2.7): `updateMember` with the fields the user changed
// only (PLAT-12 2.8: an absent field keeps its value), the intent's key, the answer put in the
// member's cache entry and every members list refreshed. A `driver` role the membership holds is
// not offered (`StaffRole` cannot send it) and the API keeps it (PLAT-12 #31). The member rules
// show as disabled controls with their reason: the caller's own membership and an owner's for a
// non-owner lock the whole form; the owner role alone is locked for a non-owner and on the last
// active owner. Loaded with `next/dynamic`, so the member page's first load carries no form code.

const accessSchema = schemas.UpdateMemberBody.required({ roles: true, site_ids: true });

type AccessValues = { roles: (typeof staffRoles)[number][]; site_ids: string[] };

function valuesOf(member: Membership): AccessValues {
  const grantable = new Set<string>(staffRoles);
  return {
    roles: (member.roles ?? []).filter((role): role is AccessValues['roles'][number] =>
      grantable.has(role),
    ),
    site_ids: [...(member.site_ids ?? [])],
  };
}

export function MemberAccessForm({
  member,
  sites,
  lock,
  ownerLock,
}: {
  member: Membership;
  sites: readonly SiteOption[];
  lock: MemberLock | undefined;
  ownerLock: OwnerRoleLock | undefined;
}) {
  const t = useTranslations('settings');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  const form = useContractForm(accessSchema, valuesOf(member), { disabled: lock !== undefined });

  return (
    <Form
      form={form}
      onSubmit={async (_, { changed, idempotencyKey }) => {
        const answer = await client.updateMember(member.id, changed, {
          fetcher,
          headers: { 'Idempotency-Key': idempotencyKey },
        });
        const updated = answer.data as Membership;
        queryClient.setQueryData(hooks.getGetMemberQueryKey(member.id), {
          data: updated,
          status: answer.status,
        });
        form.reset(valuesOf(updated));
        await queryClient.invalidateQueries({ queryKey: [memberQueryRoot] });
      }}
    >
      {lock !== undefined ? (
        <p role="note" className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
          {t(`members.locks.${lock}`)}
        </p>
      ) : null}
      <CheckboxGroupField<typeof accessSchema._input, 'roles'>
        name="roles"
        label={t('members.detail.roles')}
        options={staffRoles.map((role) => {
          const locked = role === 'owner' && ownerLock !== undefined;
          return {
            value: role,
            label: t(`roles.${role}`),
            disabled: locked,
            reason: locked ? t(`members.locks.${ownerLock}`) : undefined,
          };
        })}
      />
      {(member.roles ?? []).includes('driver') ? (
        <p className="text-sm text-muted-foreground">{t('members.detail.driver_kept')}</p>
      ) : null}
      {sites.length > 0 ? (
        <CheckboxGroupField<typeof accessSchema._input, 'site_ids'>
          name="site_ids"
          label={t('members.detail.sites')}
          description={t('members.invite_dialog.sites_hint')}
          options={sites.map((site) => ({ value: site.id, label: siteName(site, locale) }))}
        />
      ) : null}
      {lock !== undefined ? (
        <DisabledWithReason reason={t(`members.locks.${lock}`)}>
          <Button type="button" className="self-start">
            {t('members.detail.save')}
          </Button>
        </DisabledWithReason>
      ) : (
        <SubmitButton>{t('members.detail.save')}</SubmitButton>
      )}
    </Form>
  );
}
