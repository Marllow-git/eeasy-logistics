import type { CredentialsCipher } from '@eeasy-logistics/config';
import { findPlatformContext, uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AuditFacts } from '../accounts/account.service.js';
import type { AuditSink } from '../audit/audit-sink.js';
import { countRevocations } from '../auth/auth-metrics.js';
import type { Invitations } from '../auth/invitations.js';
import { enqueueMail, mailLink } from '../auth/mail-links.js';
import { platformLinkMarker } from '../auth/platform-sign-in.js';
import { enrolmentLinkTtlSeconds } from '../auth/second-factor.js';
import { compoundToken, opaqueToken, tokenHash } from '../auth/tokens.js';
import type { ListPage, ListPagePlan, PageKey } from '../contract/list-page.js';
import { oneLineTextProblem } from '../contract/text-rules.js';
import type { FieldProblem } from '../errors/api-exception.js';
import { ApiException } from '../errors/api-exception.js';
import { rolloutReasonProblem } from '../features/features.service.js';
import type { OutboxWriter } from '../outbox/outbox-writer.js';
import type { IdentityTransaction } from '../platform/identity.repository.js';
import { currentIdentity } from '../platform/identity.repository.js';
import type { StaffMemberRow, StaffSortField } from '../platform/platform-staff.repository.js';
import { PlatformStaffDirectory } from '../platform/platform-staff.repository.js';
import type { PlatformStaffRole } from '../schema/identity.js';
import type { StaffRefusal } from './staff-rules.js';
import {
  contractRoleOf,
  inviteRefusal,
  roleChangeRefusal,
  totpResetRefusal,
} from './staff-rules.js';

// The platform staff doors (PLAT-13 plan 2.9, 2.11; identity and tenancy §2, §3.3): the staff
// list, an invitation, a role change and a TOTP reset, each in the request's platform unit of work
// with its audit row (one platform connection per call). The caller's role is read from its stored
// staff row (a revoked or missing row is `401 token_invalid`, as its session would be at the next
// refresh). Nothing here ever reads, returns, logs or audits TOTP material: only whether a secret
// is enrolled.

/** The longest invited name (PLAT-12's invitation bound). */
const nameMaxLength = 120;

/** A staff member as the doors answer it: the row, or an invited user with the invited role. */
export interface StaffView {
  readonly userId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly locale: 'ar' | 'en';
  readonly secondFactorEnabled: boolean;
  readonly roles: readonly string[];
  readonly totpEnrolled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** `PlatformUser.roles`: the live role as the contract names it, none for a revoked row. */
export function viewOf(row: StaffMemberRow): StaffView {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    locale: row.locale,
    secondFactorEnabled: row.secondFactorEnabled,
    roles: row.revoked ? [] : [contractRoleOf(row.role)],
    totpEnrolled: row.totpEnrolled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * An invited user as `platformInviteStaff` answers it (adversary L-6): the request's email and name,
 * the invitation's language and the invited role, never what is stored on an existing user (their
 * phone, language or second factor), so the answer is the same whether the email had an account.
 */
function invitedView(
  userId: string,
  invited: { readonly email: string; readonly name: string; readonly locale: 'ar' | 'en' },
  role: PlatformStaffRole,
  at: Date,
): StaffView {
  return {
    userId,
    name: invited.name,
    email: invited.email,
    phone: null,
    locale: invited.locale,
    secondFactorEnabled: false,
    roles: [contractRoleOf(role)],
    totpEnrolled: false,
    createdAt: at,
    updatedAt: at,
  };
}

/** The cursor key of a staff member for `field`. */
export function staffKeyOf(field: StaffSortField, row: StaffMemberRow): PageKey {
  return { value: field === 'created_at' ? row.createdAt.toISOString() : row.name, id: row.userId };
}

/** Exactly one role (wave 0: the table holds one, a contract note), else a field problem. */
function oneRole(
  roles: readonly PlatformStaffRole[],
  allowNone: boolean,
): FieldProblem | undefined {
  if (roles.length === 1 || (allowNone && roles.length === 0)) return undefined;
  return { pointer: '/body/roles', code: 'invalid' };
}

function validationFailed(problems: readonly (FieldProblem | undefined)[]): void {
  const fields = problems.filter((problem): problem is FieldProblem => problem !== undefined);
  if (fields.length > 0) throw new ApiException('validation_failed', { fields });
}

export interface PlatformStaffDependencies {
  readonly invitations: Pick<Invitations, 'createPlatform'>;
  readonly audit: Pick<AuditSink, 'recordIn'>;
  readonly outbox: Pick<OutboxWriter, 'enqueue'>;
  /** The console's base URL of the re-enrolment link (`PUBLIC_ADMIN_URL`); none: the reset is 500. */
  readonly publicAdminUrl: string | undefined;
  /** Seals the link on the mail's outbox row (PLAT-11 item J); none: the reset is 500. */
  readonly cipher: CredentialsCipher | null;
}

export class PlatformStaffService {
  readonly #logger = new Logger('PlatformStaff');

  constructor(private readonly deps: PlatformStaffDependencies) {}

  /** The caller as stored now; a revoked or missing staff row is `401 token_invalid`. */
  private async caller(tx: IdentityTransaction): Promise<{ id: string; role: PlatformStaffRole }> {
    const id = findPlatformContext()?.userId;
    if (id === undefined) throw new Error('A platform staff door ran outside a platform request');
    const row = await tx.platformStaff.find(id);
    if (row === undefined || row.revoked) throw new ApiException('token_invalid');
    return { id, role: row.role };
  }

  private forbidden(operation: string, refusal: StaffRefusal): ApiException {
    this.#logger.log(`${operation} refused: ${refusal}`);
    return new ApiException('forbidden');
  }

  /** `platformListStaffUsers`: every staff row with its user, revoked ones included. */
  async list(plan: ListPagePlan<StaffSortField>): Promise<ListPage<StaffView>> {
    const rows = await new PlatformStaffDirectory(currentIdentity().uow).page(plan);
    const page = plan.page(rows, (row) => staffKeyOf(plan.sort.field, row));
    return { rows: page.rows.map(viewOf), nextCursor: page.nextCursor };
  }

  /**
   * `platformInviteStaff`: one role, a super admin only by a super admin (`403`); a user who is
   * live staff already is `409 invalid_transition` (a role change is `platformSetStaffRoles`, under
   * its rules); then PLAT-11's `createPlatform` in this transaction (the user, the invitation and
   * the console mail in the caller's language), and the door's `core.platform_staff.invited` row.
   */
  async invite(
    input: { readonly email: string; readonly name: string; readonly roles: PlatformStaffRole[] },
    facts: AuditFacts,
  ): Promise<StaffView> {
    validationFailed([
      oneRole(input.roles, false),
      oneLineTextProblem('/body/name', input.name, nameMaxLength),
    ]);
    const role = input.roles[0];
    if (role === undefined) throw new Error('unreachable: one role is checked above');
    const tx = currentIdentity();
    await tx.platformStaff.lockRoles();
    const caller = await this.caller(tx);
    const refusal = inviteRefusal(caller.role, role);
    if (refusal !== undefined) throw this.forbidden('platformInviteStaff', refusal);
    const email = input.email.toLowerCase();
    const existing = await tx.users.findByEmail(email);
    const staff = existing === undefined ? undefined : await tx.platformStaff.find(existing.id);
    if (staff !== undefined && !staff.revoked) {
      throw new ApiException('invalid_transition', { details: { current_status: 'active' } });
    }
    const inviter = await tx.users.find(caller.id);
    const locale = inviter?.locale ?? 'ar';
    // Adversary H-1: the email's earlier links stop working (a newer invitation supersedes them).
    const expired = await tx.invitations.expireOpenPlatform(email);
    const created = await this.deps.invitations.createPlatform(
      { email, name: input.name, role, invitedBy: caller.id, locale },
      tx,
    );
    await this.deps.audit.recordIn(tx.uow, {
      actorType: 'platform_user',
      actorId: caller.id,
      accountId: null,
      targetType: 'platform_staff',
      targetId: created.userId,
      action: 'core.platform_staff.invited',
      after: {
        role: contractRoleOf(role),
        email,
        invitation_id: created.invitationId,
        invitations_expired: expired,
      },
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
    return invitedView(created.userId, { email, name: input.name, locale }, role, new Date());
  }

  /**
   * `platformSetStaffRoles`: `roles` is one role or none (revoke); the rules of `staff-rules.ts`
   * under a lock that serialises every role change; an unchanged role writes nothing. A change ends
   * the target's platform sessions (every platform family revoked, as PLAT-12's member change does),
   * so the new role applies from the next sign-in; a revoked row keeps its role and TOTP, and a
   * later role restores it with the TOTP kept (adversary round 2: a lost device is a TOTP reset).
   */
  async setRoles(
    userId: string,
    roles: PlatformStaffRole[],
    facts: AuditFacts,
  ): Promise<StaffView> {
    validationFailed([oneRole(roles, true)]);
    const next = roles[0] ?? null;
    const tx = currentIdentity();
    await tx.platformStaff.lockRoles();
    const caller = await this.caller(tx);
    const directory = new PlatformStaffDirectory(tx.uow);
    if (caller.id === userId) throw this.forbidden('platformSetStaffRoles', 'self');
    const target = await directory.find(userId);
    if (target === undefined) throw new ApiException('not_found');
    const current = target.revoked ? null : target.role;
    const refusal = roleChangeRefusal({
      callerId: caller.id,
      callerRole: caller.role,
      targetId: userId,
      current,
      next,
      liveSuperAdmins: await tx.platformStaff.liveSuperAdmins(),
    });
    if (refusal !== undefined) throw this.forbidden('platformSetStaffRoles', refusal);
    if (next === current) return viewOf(target);
    if (next === null) await tx.platformStaff.revoke(userId);
    else if (current === null) await tx.platformStaff.restore(userId, next, caller.id);
    else await tx.platformStaff.setRole(userId, next, caller.id);
    const families = await tx.refreshTokens.revokeAll(userId, 'revoked', {
      surface: 'platform',
      membershipId: null,
    });
    countRevocations('revoked', families.length);
    // Adversary H-1: a link sent before this change (another role, perhaps super admin) is stale.
    const expired =
      target.email === null ? 0 : await tx.invitations.expireOpenPlatform(target.email);
    await this.deps.audit.recordIn(tx.uow, {
      actorType: 'platform_user',
      actorId: caller.id,
      accountId: null,
      targetType: 'platform_staff',
      targetId: userId,
      action: 'core.platform_staff.roles_changed',
      before: { roles: current === null ? [] : [contractRoleOf(current)] },
      after: {
        roles: next === null ? [] : [contractRoleOf(next)],
        sessions_ended: families.length,
        invitations_expired: expired,
      },
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
    const changed = await directory.find(userId);
    if (changed === undefined) throw new Error('The staff row vanished under its lock');
    return viewOf(changed);
  }

  /**
   * `platformResetStaffTotp` (mirrors PLAT-11's staff second-factor reset): a super admin only,
   * never on oneself (`403`); a user with no live staff row is `404`. In one transaction: the TOTP
   * secret and key id cleared (the replay guard kept as the marker that only the link enrols, M-2),
   * `token_version + 1`, every platform family revoked, open TOTP challenges and earlier platform
   * links spent, a one-time re-enrolment link (an `enrolment_link` challenge, 24 hours) mailed with
   * the `platform_totp_reset` notice (`PUBLIC_ADMIN_URL/totp/enrol/<token>`, sealed on the outbox
   * row), and `core.platform_staff.totp_reset` audited with the reason. The password alone no longer
   * enrols (adversary M-2): `platformRedeemEnrolmentLink` with the link and the password does.
   */
  async resetTotp(userId: string, reason: string, facts: AuditFacts): Promise<void> {
    const problem = rolloutReasonProblem(reason);
    validationFailed([
      problem === undefined ? undefined : { pointer: '/body/reason', code: problem },
    ]);
    const linkId = uuidv7();
    const linkSecret = opaqueToken();
    const link = mailLink(
      this.deps.publicAdminUrl,
      'totp/enrol',
      compoundToken(linkId, linkSecret),
    );
    const tx = currentIdentity();
    const caller = await this.caller(tx);
    const refusal = totpResetRefusal(caller.id, caller.role, userId);
    if (refusal !== undefined) throw this.forbidden('platformResetStaffTotp', refusal);
    const user = await tx.users.lock(userId);
    const staff = await tx.platformStaff.lockTotp(userId);
    if (user === undefined || user.disabled || user.email === null) {
      throw new ApiException('not_found');
    }
    if (staff === undefined || staff.revoked) throw new ApiException('not_found');
    await tx.platformStaff.resetTotp(userId);
    await tx.users.endSessions(userId);
    const families = await tx.refreshTokens.revokeAll(userId, 'revoked', {
      surface: 'platform',
      membershipId: null,
    });
    countRevocations('revoked', families.length);
    await tx.challenges.consumeOpen(userId, 'totp');
    await tx.challenges.consumeOpenMarked(userId, 'enrolment_link', platformLinkMarker);
    const linkExpiresAt = await tx.challenges.insert({
      id: linkId,
      kind: 'enrolment_link',
      userId,
      secretHash: tokenHash(linkSecret),
      amr: [platformLinkMarker],
      membershipIds: null,
      ttlSeconds: enrolmentLinkTtlSeconds,
      ip: null,
    });
    await enqueueMail(
      this.deps.outbox,
      tx,
      {
        type: 'core.platform_staff.totp_reset',
        aggregate: { type: 'auth_challenge', id: linkId },
        template: 'platform_totp_reset',
        to: user.email,
        locale: user.locale,
        params: { link },
        supersedeKey: `platform_totp_reset:${userId}`,
      },
      this.deps.cipher,
    );
    await this.deps.audit.recordIn(tx.uow, {
      actorType: 'platform_user',
      actorId: caller.id,
      accountId: null,
      targetType: 'platform_staff',
      targetId: userId,
      action: 'core.platform_staff.totp_reset',
      after: {
        sessions_ended: families.length,
        was_enrolled: staff.totpEnrolled,
        link_expires_at: linkExpiresAt.toISOString(),
      },
      reason: reason.trim(),
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
    this.#logger.log(`platform totp reset user_id=${userId}`);
  }
}
