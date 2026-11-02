'use client';

import { client, schemas, type Me } from '@eeasy-logistics/contracts/staff';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@eeasy-logistics/ui/components/dialog';
import { Form, SubmitButton, useContractForm } from '@eeasy-logistics/ui/form';
import { CheckboxGroupField, TextField } from '@eeasy-logistics/ui/form/fields';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSession, useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { siteName, type SiteOption } from '../site-options';
import { grantableRoles } from './member-rules';
import { memberQueryRoot } from './member-keys';
import { staffRoles } from './member-roles';

// The invite dialog (WEB-3 plan 2.7; design references: Bonsai and Browserbase, one modal with the
// email, the roles and the sites, one primary button): `inviteMember` with the intent's key; the
// owner role is offered to owners only and shown locked with the rule to the others (PLAT-12 2.7);
// a `429 rate_limited` (the account's invitation budget, PLAT-12 #42) shows the wait and holds the
// button. Loaded on open (`next/dynamic`), so the members page carries no form code until then.

/** One line, 1 to 120 code points: the API's rule for the invited name (PLAT-12 #22). */
const inviteSchema = schemas.InviteMemberBody.extend({
  name: schemas.InviteMemberBody.shape.name
    .min(1)
    .regex(/^[^\r\n\u0085\u2028\u2029]*$/)
    .refine((value) => [...value].length <= 120, { message: 'too_long' }),
});

export function InviteDialog({
  open,
  onOpenChange,
  sites,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sites: readonly SiteOption[];
  onInvited: (email: string) => void;
}) {
  const t = useTranslations('settings');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  const me = useSession<Me>();
  const caller = { membershipId: me.membership?.id, roles: me.membership?.roles ?? [] };
  const form = useContractForm(inviteSchema, { email: '', name: '', roles: [], site_ids: [] });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('members.invite_dialog.title')}</DialogTitle>
        <DialogDescription>{t('members.invite_dialog.description')}</DialogDescription>
        <Form
          form={form}
          onSubmit={async (values, { idempotencyKey }) => {
            await client.inviteMember(values, {
              fetcher,
              headers: { 'Idempotency-Key': idempotencyKey },
            });
            await queryClient.invalidateQueries({ queryKey: [memberQueryRoot] });
            onInvited(values.email);
          }}
        >
          <TextField<typeof inviteSchema._input, 'email'>
            name="email"
            type="email"
            label={t('members.invite_dialog.email')}
            input={{ dir: 'ltr', autoComplete: 'off' }}
          />
          <TextField<typeof inviteSchema._input, 'name'>
            name="name"
            label={t('members.invite_dialog.name')}
            input={{ dir: 'auto', autoComplete: 'off' }}
          />
          <CheckboxGroupField<typeof inviteSchema._input, 'roles'>
            name="roles"
            label={t('members.invite_dialog.roles')}
            description={t('members.invite_dialog.roles_hint')}
            options={grantableRoles(caller, staffRoles).map(({ role, locked }) => ({
              value: role,
              label: t(`roles.${role}`),
              disabled: locked,
              reason: locked ? t('members.locks.owner_grant') : undefined,
            }))}
          />
          {sites.length > 0 ? (
            <CheckboxGroupField<typeof inviteSchema._input, 'site_ids'>
              name="site_ids"
              label={t('members.invite_dialog.sites')}
              description={t('members.invite_dialog.sites_hint')}
              options={sites.map((site) => ({ value: site.id, label: siteName(site, locale) }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('members.invite_dialog.no_sites')}</p>
          )}
          <SubmitButton>{t('members.invite_dialog.submit')}</SubmitButton>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
