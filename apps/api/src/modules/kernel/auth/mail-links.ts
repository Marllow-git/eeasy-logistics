import type { CredentialsCipher } from '@eeasy-logistics/config';
import type { Locale } from '@eeasy-logistics/i18n/templates';
import { ApiException } from '../errors/api-exception.js';
import type { OutboxWriter } from '../outbox/outbox-writer.js';
import type { DomainEventType } from '../outbox/domain-event.js';
import type { IdentityTransaction } from '../platform/identity.repository.js';
import type { TemplateKey } from '../messaging/templates.js';
import type { TemplateDefinition } from '../messaging/templates.js';
import { messageTemplates, templateParamsProblem } from '../messaging/templates.js';

// The mails of invitations and resets (PLAT-11 plan 2.10; PLAT-9 templates, adversary L-7): one
// `message` outbox row with `channel: mail`, written in the identity transaction (a platform unit
// of work, so the row is platform-only: the platform outbox doors show it as metadata only, never
// its payload). The link is `<public URL>/<path>/<token>` per web.md §1's routes.

/** `<base>/<path>/<token>`, or `500` when the public URL is not configured. */
export function mailLink(base: string | undefined, path: string, token: string): string {
  if (base === undefined) throw new ApiException('internal_error');
  return `${base.replace(/\/+$/, '')}/${path}/${token}`;
}

export interface MailRow {
  readonly type: DomainEventType;
  readonly aggregate: { readonly type: string; readonly id: string };
  readonly template: Extract<
    TemplateKey,
    | 'invitation'
    | 'platform_invitation'
    | 'password_reset'
    | 'second_factor_reset'
    | 'platform_totp_reset'
  >;
  readonly to: string;
  readonly locale: Locale;
  readonly params: Readonly<Record<string, string>>;
  /** A newer mail of the same key replaces a pending one (a re-invitation, a second reset). */
  readonly supersedeKey: string;
}

/**
 * Enqueues the mail. The parameters are checked against the template first (PLAT-9 adversary L-7:
 * no line break, no link outside `link`, the account name at most 80 characters); a value that
 * fails is a fault of the stored data, never sent. The template's secret parameters (the one-time
 * link) are stored encrypted with the credentials cipher under `<table>:<aggregate id>` (item J;
 * the `message` handler decrypts them at send time), so no database role reads a live link from
 * the outbox during its retention; without credentials keys the door answers 500.
 */
export async function enqueueMail(
  outbox: Pick<OutboxWriter, 'enqueue'>,
  tx: IdentityTransaction,
  mail: MailRow,
  cipher: CredentialsCipher | null,
): Promise<void> {
  const problem = templateParamsProblem(mail.template, mail.params);
  if (problem !== undefined) throw new Error(`Mail ${mail.template} refused: ${problem}`);
  const definition: TemplateDefinition = messageTemplates[mail.template];
  const params: Record<string, string | { encrypted: string }> = { ...mail.params };
  for (const name of definition.secretParams) {
    const value = mail.params[name];
    if (value === undefined) continue;
    if (cipher === null || definition.secretContext === undefined) {
      throw new ApiException('internal_error');
    }
    const sealed = cipher.encrypt(value, `${definition.secretContext}:${mail.aggregate.id}`);
    params[name] = { encrypted: sealed.blob.toString('base64') };
  }
  await outbox.enqueue(tx.uow, {
    type: mail.type,
    version: 1,
    aggregate: { ...mail.aggregate, version: 1 },
    kind: 'message',
    supersedeKey: mail.supersedeKey,
    payload: {
      channel: 'mail',
      template_key: mail.template,
      to: mail.to,
      locale: mail.locale,
      params,
    },
  });
}
