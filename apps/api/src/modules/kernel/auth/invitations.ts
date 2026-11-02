import type { CredentialsCipher } from '@eeasy-logistics/config';
import type { Locale } from '@eeasy-logistics/i18n/templates';
import { uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { assertRoleCombination } from '../authz/separation.js';
import { ApiException } from '../errors/api-exception.js';
import type { OutboxWriter } from '../outbox/outbox-writer.js';
import type { AuditSink } from '../audit/audit-sink.js';
import type { IdentityStore, IdentityTransaction } from '../platform/identity.repository.js';
import type { PlatformStaffRole } from '../schema/identity.js';
import { enqueueMail, mailLink } from './mail-links.js';
import { opaqueToken, tokenHash } from './tokens.js';

// Invitations (PLAT-11 plan 2.10; identity and tenancy §3.1): a one-time token valid 72 hours,
// mailed as a link to the web (`/invitations/<token>`) or the console (`/invitations/<token>` on the
// admin host). PLAT-12's `inviteMember` calls `createStaff`, PLAT-13's `platformInviteStaff` and the
// bootstrap command call `createPlatform`. Each runs in one platform transaction of its own: the
// user, the membership, the invitation and its mail commit together.

export const invitationTtlSeconds = 72 * 3600;

export interface StaffInvitation {
  readonly accountId: string;
  readonly email: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly siteIds: readonly string[];
  /** The inviting user; null only for a system invitation. */
  readonly invitedBy: string | null;
  readonly locale: Locale;
}

export interface PlatformInvitation {
  readonly email: string;
  readonly name: string;
  readonly role: PlatformStaffRole;
  /** The inviting super admin; null for the bootstrap command (plan 2.12). */
  readonly invitedBy: string | null;
  readonly locale: Locale;
}

/**
 * A created invitation: ids only. The accept link goes by mail and nowhere else (adversary M-3): a
 * door that echoed it would let the inviter accept on the invitee's behalf.
 */
export interface CreatedInvitation {
  readonly invitationId: string;
  readonly userId: string;
  readonly membershipId: string | null;
}

/** The bootstrap's invitation: no mail is sent, so the command prints the link once. */
export interface BootstrappedInvitation extends CreatedInvitation {
  readonly link: string;
}

export interface InvitationsDependencies {
  readonly store: IdentityStore | null;
  readonly outbox: Pick<OutboxWriter, 'enqueue'>;
  readonly resolver: Pick<PermissionResolver, 'bundles'> | undefined;
  readonly publicWebUrl: string | undefined;
  readonly publicAdminUrl: string | undefined;
  /** Encrypts the link on the mail's outbox row (item J); null without credentials keys. */
  readonly cipher: CredentialsCipher | null;
}

export class Invitations {
  readonly #deps: InvitationsDependencies;
  readonly #logger = new Logger('Invitations');

  constructor(deps: InvitationsDependencies) {
    this.#deps = deps;
  }

  /**
   * Invites `email` to the account: finds or creates the user, creates the `invited` membership (or
   * re-invites an invited or revoked one with the new roles) after the role-combination check
   * (PLAT-10 A-7), replaces any open invitation of the membership, and mails the link. An active
   * membership answers `409 invalid_transition` (nothing to accept).
   */
  async createStaff(input: StaffInvitation): Promise<CreatedInvitation> {
    const store = this.#store();
    const resolver = this.#deps.resolver;
    if (resolver === undefined) throw new ApiException('internal_error');
    assertRoleCombination(input.roles, resolver.bundles);
    const email = input.email.toLowerCase();
    const token = opaqueToken();
    const link = mailLink(this.#deps.publicWebUrl, 'invitations', token);
    const created = await store.run(async (tx) => {
      const account = await tx.accounts.find(input.accountId);
      if (account === undefined || account.status === 'closed') throw new ApiException('not_found');
      const user = await tx.users.findByEmail(email);
      const userId = user?.id ?? uuidv7();
      if (user === undefined) {
        await tx.users.insert({ id: userId, name: input.name, email, locale: input.locale });
      }
      const existing = await tx.memberships.findInAccount(input.accountId, userId);
      let membershipId: string;
      if (existing === undefined) {
        membershipId = uuidv7();
        await tx.memberships.insert({
          id: membershipId,
          accountId: input.accountId,
          userId,
          roles: input.roles,
          siteIds: input.siteIds,
        });
      } else if (existing.status === 'active') {
        throw new ApiException('invalid_transition', { details: { current_status: 'active' } });
      } else {
        membershipId = existing.id;
        // A `driver` role the drivers resource gave stays (as `updateMember` keeps it, PLAT-12 8.2
        // #31; `StaffRole` cannot send it), and the combination is checked over the result
        // (PLAT-12 adversary L-2; PLAT-10 A-7).
        const kept = existing.roles.filter((role) => role === 'driver');
        const roles = [...new Set([...input.roles, ...kept])];
        assertRoleCombination(roles, resolver.bundles);
        await tx.memberships.reinvite(membershipId, roles, input.siteIds);
        await tx.invitations.expireOpenOf(membershipId);
      }
      const invitationId = uuidv7();
      await tx.invitations.insert({
        id: invitationId,
        kind: 'staff',
        accountId: input.accountId,
        membershipId,
        platformRole: null,
        email,
        name: input.name,
        locale: input.locale,
        tokenHash: tokenHash(token),
        ttlSeconds: invitationTtlSeconds,
        invitedBy: input.invitedBy,
      });
      await enqueueMail(
        this.#deps.outbox,
        tx,
        {
          type: 'core.invitation.created',
          aggregate: { type: 'invitation', id: invitationId },
          template: 'invitation',
          to: email,
          locale: input.locale,
          params: { account_name: account.name, link },
          supersedeKey: `invitation:${membershipId}`,
        },
        this.#deps.cipher,
      );
      return { invitationId, userId, membershipId };
    });
    this.#logger.log(`staff invitation created membership_id=${created.membershipId ?? ''}`);
    return created;
  }

  /** Invites `email` as platform staff with `role`; the console link, no membership. */
  async createPlatform(input: PlatformInvitation): Promise<CreatedInvitation> {
    const store = this.#store();
    const token = opaqueToken();
    const link = mailLink(this.#deps.publicAdminUrl, 'invitations', token);
    const created = await store.run((tx) => this.#platform(tx, input, token, link, true));
    this.#logger.log(`platform invitation created role=${input.role}`);
    return created;
  }

  /**
   * The first super admin (plan 2.12, the `--role bootstrap` command): under a transaction-scoped
   * advisory lock, refuses (undefined) when any platform staff row or a live super admin invitation
   * exists, or when the email belongs to a disabled user (adversary L-8: that link could never be
   * accepted and would block reruns for 72 hours); else creates the invitation without a mail (SMTP
   * may not exist yet; the command prints the link once) and audits
   * `core.platform_staff.bootstrapped` as the system.
   */
  async bootstrap(
    input: { readonly email: string; readonly name: string; readonly locale: Locale },
    audit: Pick<AuditSink, 'record'>,
    runId: string,
  ): Promise<BootstrappedInvitation | undefined> {
    const store = this.#store();
    const token = opaqueToken();
    const link = mailLink(this.#deps.publicAdminUrl, 'invitations', token);
    return store.run(async (tx) => {
      await tx.platformStaff.lockBootstrap();
      if (await tx.platformStaff.bootstrapped()) return undefined;
      const existing = await tx.users.findByEmail(input.email.toLowerCase());
      if (existing?.disabled === true) return undefined;
      const created = await this.#platform(
        tx,
        { ...input, role: 'super_admin', invitedBy: null },
        token,
        link,
        false,
      );
      await audit.record({
        actorType: 'system',
        actorId: null,
        accountId: null,
        targetType: 'invitation',
        targetId: created.invitationId,
        action: 'core.platform_staff.bootstrapped',
        after: { role: 'super_admin', user_id: created.userId },
        requestId: runId,
      });
      return { ...created, link };
    });
  }

  async #platform(
    tx: IdentityTransaction,
    input: PlatformInvitation,
    token: string,
    link: string,
    mail: boolean,
  ): Promise<CreatedInvitation> {
    const email = input.email.toLowerCase();
    const user = await tx.users.findByEmail(email);
    const userId = user?.id ?? uuidv7();
    if (user === undefined) {
      await tx.users.insert({ id: userId, name: input.name, email, locale: input.locale });
    }
    const invitationId = uuidv7();
    await tx.invitations.insert({
      id: invitationId,
      kind: 'platform',
      accountId: null,
      membershipId: null,
      platformRole: input.role,
      email,
      name: input.name,
      locale: input.locale,
      tokenHash: tokenHash(token),
      ttlSeconds: invitationTtlSeconds,
      invitedBy: input.invitedBy,
    });
    if (mail) {
      await enqueueMail(
        this.#deps.outbox,
        tx,
        {
          type: 'core.invitation.created',
          aggregate: { type: 'invitation', id: invitationId },
          template: 'platform_invitation',
          to: email,
          locale: input.locale,
          params: { link },
          supersedeKey: `platform_invitation:${userId}`,
        },
        this.#deps.cipher,
      );
    }
    return { invitationId, userId, membershipId: null };
  }

  #store(): IdentityStore {
    const store = this.#deps.store;
    if (store === null) throw new ApiException('internal_error');
    return store;
  }
}
