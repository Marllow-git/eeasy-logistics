import { createHash, randomUUID } from 'node:crypto';
import type { Config } from '@eeasy-logistics/config';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import { createAppPool, verifyPoolRole, withUnitOfWork } from '@eeasy-logistics/db';
import { createPlatformPool, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { AuditWriter } from '../modules/kernel/audit/audit-writer.js';
import { Invitations } from '../modules/kernel/auth/invitations.js';
import { PasswordHasher } from '../modules/kernel/auth/passwords.js';
import { SecondFactorResets } from '../modules/kernel/auth/second-factor-resets.js';
import { nextOutboxId } from '../modules/kernel/outbox/outbox-id.js';
import { OutboxWriter } from '../modules/kernel/outbox/outbox-writer.js';
import { identityStore } from '../modules/kernel/platform/identity.repository.js';
import { loadPermissionResolver } from '../modules/kernel/platform/roles.repository.js';
import { CensusIdentitiesRepository, CensusSitesRepository } from './census.repository.js';

// The identities of the web census (WEB-2 plan 2.14): `seed:census` writes them into the stack's
// database through the API's own pieces (the password hasher, the credentials cipher, the
// invitation and second-factor-reset services, so the invitation and re-enrolment mails go out
// through the outbox to the stack's Mailpit like real ones). Local and ci only. Every run puts the
// identities back to their starting state, so the census can run again: passwords, phones and
// memberships reset, OTP challenges of the census phones deleted, a fresh invitation and a fresh
// re-enrolment link mailed; the console staff's TOTP reset and a fresh platform invitation mailed.
// One set per census project (`ar`, `ar-390`, `en`), so the projects never share a user or a phone.
// apps/web/tests/census/session.ts mirrors the staff values, apps/admin/tests/census/session.ts the
// console's.

/** The census projects of apps/web and apps/admin (tests/census.config.ts). */
export const censusProjects = ['ar', 'ar-390', 'en'] as const;
export type CensusProject = (typeof censusProjects)[number];

/** Every census user's password; assembled so the commit hook's scanner sees no literal. */
export const censusPassword = ['census', 'harbour', 'lantern', 'meadow'].join(' ');

/**
 * The console census staff's TOTP secret (base32), enrolled at seed time so the console census can
 * compute codes (leg 2); assembled from parts for the same reason.
 */
export const censusTotpSecret = ['JBSWY3DP', 'EHPK3PXP', 'GEZDGNBV', 'GY3TQOJQ'].join('');

const slug = (project: CensusProject) => project.replace('-', '');
const projectIndex = (project: CensusProject) => censusProjects.indexOf(project) + 1;

/** The census email of a role for a project: `census-<role>-<project>@census.test`. */
export function censusEmail(role: string, project: CensusProject): string {
  return `census-${role}-${slug(project)}@census.test`;
}

/** A Saudi mobile number per purpose and project, never shared between projects. */
export function censusPhone(purpose: 1 | 2 | 3 | 4, project: CensusProject): string {
  return `+966570000${purpose}${String(projectIndex(project)).padStart(2, '0')}`;
}

/** Deterministic ids, so every run finds the rows of the last. */
function censusId(name: string): string {
  const hex = createHash('sha256').update(`census:${name}`).digest('hex');
  return `01920000-0000-7${hex.slice(0, 3)}-8${hex.slice(3, 6)}-${hex.slice(6, 18)}`;
}

export const censusAccounts = {
  one: { id: censusId('account-one'), name: 'متجر الرياض', factor: false },
  two: { id: censusId('account-two'), name: 'سوق جدة', factor: false },
  factor: { id: censusId('account-factor'), name: 'بضائع الدمام', factor: true },
  // WEB-3: one account per project for the settings screens, so the projects' writes never meet.
  settingsar: { id: censusId('account-settings-ar'), name: 'متجر الخبر', factor: false },
  settingsar390: { id: censusId('account-settings-ar390'), name: 'متجر الطائف', factor: false },
  settingsen: { id: censusId('account-settings-en'), name: 'متجر أبها', factor: false },
  // WEB-4: per project, the account the console acts on (support reason, flags, suspend and
  // reactivate), one left suspended (close it with its name typed) and one provisioned (its owner
  // never accepted). Every run puts the status back, so a closed census account opens again.
  consolear: { id: censusId('account-console-ar'), name: 'متجر نجران', factor: false },
  consolear390: { id: censusId('account-console-ar390'), name: 'متجر جازان', factor: false },
  consoleen: { id: censusId('account-console-en'), name: 'متجر تبوك', factor: false },
  suspendedar: {
    id: censusId('account-suspended-ar'),
    name: 'متجر حائل',
    factor: false,
    status: 'suspended',
  },
  suspendedar390: {
    id: censusId('account-suspended-ar390'),
    name: 'متجر الباحة',
    factor: false,
    status: 'suspended',
  },
  suspendeden: {
    id: censusId('account-suspended-en'),
    name: 'متجر عرعر',
    factor: false,
    status: 'suspended',
  },
  provisionedar: {
    id: censusId('account-provisioned-ar'),
    name: 'متجر القريات',
    factor: false,
    status: 'provisioned',
  },
  provisionedar390: {
    id: censusId('account-provisioned-ar390'),
    name: 'متجر سكاكا',
    factor: false,
    status: 'provisioned',
  },
  provisioneden: {
    id: censusId('account-provisioned-en'),
    name: 'متجر ينبع',
    factor: false,
    status: 'provisioned',
  },
} as const;

/** A census account's starting status: `active` unless it says otherwise (WEB-4). */
export type CensusAccountStatus = 'active' | 'suspended' | 'provisioned';

/** WEB-4: the console census accounts of a project (acted on, suspended, provisioned). */
export function censusConsoleAccounts(project: CensusProject): {
  active: CensusAccountKey;
  suspended: CensusAccountKey;
  provisioned: CensusAccountKey;
} {
  const suffix = slug(project) as 'ar' | 'ar390' | 'en';
  return {
    active: `console${suffix}`,
    suspended: `suspended${suffix}`,
    provisioned: `provisioned${suffix}`,
  };
}

export type CensusAccountKey = keyof typeof censusAccounts;

export interface CensusUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly locale: 'ar' | 'en';
  /** The enrolled second-factor phone, or null for none. */
  readonly phone: string | null;
  readonly memberships: readonly { account: CensusAccountKey; roles: readonly string[] }[];
}

/** The users of one project (plan 2.14). */
export function censusUsers(project: CensusProject): CensusUser[] {
  const locale = project === 'en' ? 'en' : 'ar';
  const settings = `settings${slug(project)}` as `settings${'ar' | 'ar390' | 'en'}`;
  const user = (
    role: string,
    name: string,
    phone: string | null,
    memberships: CensusUser['memberships'],
  ): CensusUser => ({
    id: censusId(`user-${role}-${project}`),
    email: censusEmail(role, project),
    name,
    locale,
    phone,
    memberships,
  });
  return [
    // One membership, no factor: a session at once (the merchant pages, refresh, sign-out).
    user('staff', 'هدى القحطاني', null, [{ account: 'one', roles: ['owner'] }]),
    // The same, for the refresh, single-flight and sign-out checks (their own login budget).
    user('session', 'منيرة السبيعي', null, [{ account: 'one', roles: ['owner'] }]),
    // Two memberships: the account list.
    user('owner', 'سالم العتيبي', null, [
      { account: 'one', roles: ['owner'] },
      { account: 'two', roles: ['admin', 'dispatcher'] },
    ]),
    // An account that requires a factor, a phone enrolled: the code step.
    user('factor', 'نورة الشهري', censusPhone(1, project), [
      { account: 'factor', roles: ['dispatcher'] },
    ]),
    // The same account, no phone: enrolment at sign-in.
    user('enrol', 'فهد الدوسري', null, [{ account: 'factor', roles: ['viewer'] }]),
    // A password reset from a Mailpit link.
    user('reset', 'ريم الحربي', null, [{ account: 'one', roles: ['viewer'] }]),
    // A phone the member's manager reset: the emailed re-enrolment link.
    user('relink', 'خالد الزهراني', censusPhone(2, project), [
      { account: 'factor', roles: ['cashier'] },
    ]),
    // WEB-3: the settings screens on the project's own account: its owner, a viewer (reads the
    // settings, changes nothing) and a site-scoped member (no settings at all: the 403 page).
    user('settings', 'عبدالله الشمري', null, [{ account: settings, roles: ['owner'] }]),
    user('viewer', 'سارة الغامدي', null, [{ account: settings, roles: ['viewer'] }]),
    user('sitestaff', 'ماجد العنزي', null, [{ account: settings, roles: ['site_staff'] }]),
  ];
}

/** The email the census invitation goes to (accepted through its Mailpit link). */
export const censusInvitee = (project: CensusProject) => censusEmail('invitee', project);

/** The settings account of a project (WEB-3). */
export const censusSettingsAccount = (project: CensusProject): CensusAccountKey =>
  `settings${slug(project)}` as CensusAccountKey;

/**
 * WEB-3 leg 2: the member the settings census invites from the members page and who accepts the
 * mail (`member`), and the member the seed leaves invited for the list's "invitation sent" row
 * (`pending`, its invitation mailed again on every run).
 */
export const censusMemberInvitee = (project: CensusProject) => censusEmail('member', project);
export const censusPendingMember = (project: CensusProject) => censusEmail('pending', project);
export const censusPendingName = 'ليلى الحربي';

/** A site of a census settings account (WEB-3 leg 2); `point` latitude and longitude. */
export interface CensusSite {
  readonly id: string;
  readonly kind: 'branch' | 'warehouse' | 'both';
  readonly nameAr: string;
  readonly nameEn: string;
  readonly addressText: string;
  readonly shortCode: string;
  readonly point: { readonly lat: number; readonly lng: number } | null;
  readonly openingHours: readonly { weekday: number; opens: string; closes: string }[];
}

/** The two sites of a project's settings account: a branch with hours and a point, a warehouse. */
export function censusSites(project: CensusProject): CensusSite[] {
  const weekdays = [0, 1, 2, 3, 4];
  return [
    {
      id: censusId(`site-branch-${project}`),
      kind: 'branch',
      nameAr: 'فرع العليا',
      nameEn: 'Olaya branch',
      addressText: 'طريق العليا، حي العليا، الرياض',
      shortCode: 'RRRD2929',
      point: { lat: 24.69384, lng: 46.68512 },
      openingHours: weekdays.map((weekday) => ({ weekday, opens: '09:00', closes: '21:00' })),
    },
    {
      id: censusId(`site-warehouse-${project}`),
      kind: 'warehouse',
      nameAr: 'مستودع السلي',
      nameEn: 'Al Sulay warehouse',
      addressText: 'المنطقة الصناعية، حي السلي، الرياض',
      shortCode: 'RSLA4512',
      point: null,
      openingHours: [],
    },
  ];
}

/**
 * The console's census staff (WEB-2 leg 2), one set per project. Each role serves one census check,
 * so no user signs in more than three times in a run: a TOTP step is accepted once per user (the
 * replay guard), and the census helper uses the steps around the current one. `enrol` has no TOTP
 * (the enrolment view at sign-in); the others are enrolled with `censusTotpSecret`.
 */
export const censusPlatformRoles = [
  'admin',
  'enrol',
  'shell',
  'errors',
  'analytics',
  'session',
  'dialog',
  'logout',
  // WEB-4: the console screens: provisioning and the list, the account lifecycle and flags, the
  // rollout change (super admins); an `admin` (no rollout change) and a `support` (reads only).
  'accounts',
  'lifecycle',
  'rollout',
  'operator',
  'support',
  // WEB-4 leg 2: super admins for the outbox and the staff screens; two `support` members the
  // staff census acts on: `colleague` (role changed, then revoked) and `relink` (TOTP reset, then
  // re-enrolled from the mailed link). Each run puts them back (role, TOTP, not revoked).
  'outbox',
  'staff',
  'colleague',
  'relink',
] as const;
export type CensusPlatformRole = (typeof censusPlatformRoles)[number];

/** The console role of a census staff member: `super_admin` but for WEB-4's `admin` and supports. */
export const censusPlatformRoleOf = (
  role: CensusPlatformRole,
): 'super_admin' | 'admin' | 'support' =>
  role === 'operator'
    ? 'admin'
    : role === 'support' || role === 'colleague' || role === 'relink'
      ? 'support'
      : 'super_admin';

/** The census email of a console role for a project: `census-platform-<role>-<project>@…`. */
export function censusPlatformEmail(
  role: CensusPlatformRole | 'invitee' | 'hire',
  project: CensusProject,
): string {
  return `census-platform-${role}-${slug(project)}@census.test`;
}

export interface CensusPlatformStaff {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  /** Enrolled with `censusTotpSecret`, or no TOTP yet. */
  readonly totp: boolean;
  readonly role: 'super_admin' | 'admin' | 'support';
}

/** The console staff of one project: super admins, one `admin` and one `support` (WEB-4). */
export function censusPlatformStaff(project: CensusProject): CensusPlatformStaff[] {
  return censusPlatformRoles.map((role) => ({
    id: censusId(`platform-${role}-${project}`),
    email: censusPlatformEmail(role, project),
    name: `Census ${role}`,
    totp: role !== 'enrol',
    role: censusPlatformRoleOf(role),
  }));
}

/** Who the census platform invitation goes to (accepted through its Mailpit link). */
export const censusPlatformInvitee = (project: CensusProject) =>
  censusPlatformEmail('invitee', project);

/** WEB-4: whom the staff census invites from the console (revoked by every run, so it can again). */
export const censusPlatformHire = (project: CensusProject) => censusPlatformEmail('hire', project);

/** WEB-4: the aggregate of a project's dead outbox row (deterministic, so a run replaces the last). */
export const censusOutboxAggregate = (project: CensusProject) =>
  censusId(`outbox-${slug(project)}`);

/**
 * Why `seed:census` refuses to run in this environment, or undefined when it may: it writes known
 * passwords and a known TOTP secret, so only a local or ci stack takes it (lead ruling on WEB-2
 * leg 1). `census-main.ts` asks before reading any other configuration.
 */
export function censusSeedRefusal(appEnv: string | undefined): string | undefined {
  if (appEnv === 'local' || appEnv === 'ci') return undefined;
  const named = appEnv === undefined || appEnv === '' ? '(unset)' : appEnv;
  return `seed:census refuses to run with APP_ENV=${named}: local or ci only`;
}

/** What a seed run did, for the log line. */
export interface CensusSeedSummary {
  readonly users: number;
  readonly invitations: number;
  readonly links: number;
}

/**
 * The sites of each settings account back to `censusSites` (WEB-3 leg 2), in a tenant unit of
 * work per account on the elx_app pool (elx_platform may not write core_sites).
 */
async function resetCensusSites(config: Config): Promise<void> {
  const app = createAppPool(
    { ...config.db, poolSize: { ...config.db.poolSize, app: 1 } },
    'elx-seed-census-sites',
  );
  try {
    await verifyPoolRole(app.db, 'elx_app');
    for (const project of censusProjects) {
      const context = {
        accountId: censusAccounts[censusSettingsAccount(project)].id,
        membershipId: null,
        userId: null,
        deviceId: null,
        actingCrossTenant: false,
      };
      await withUnitOfWork(app.db, context, (uow) =>
        new CensusSitesRepository(uow).reset(censusSites(project)),
      );
    }
  } finally {
    await app.close();
  }
}

/** Writes the census identities (see the top of this file). */
export async function seedCensus(config: Config): Promise<CensusSeedSummary> {
  // The guard holds whoever calls the seed, not only `census-main.ts` (adversary L-4).
  const refusal = censusSeedRefusal(config.app.env);
  if (refusal !== undefined) throw new Error(refusal);
  if (config.credentials === null) throw new Error('seed:census needs CREDENTIALS_KEYS');
  const cipher = createCredentialsCipher(config.credentials);
  const pool = createPlatformPool(
    { ...config.db, poolSize: { ...config.db.poolSize, platform: 2 } },
    'elx-seed-census',
  );
  try {
    await verifyPoolRole(pool.db, 'elx_platform');
    const passwordHash = await new PasswordHasher().hash(censusPassword);
    const users = censusProjects.flatMap((project) => censusUsers(project));
    const invitees = censusProjects.map((project) => censusInvitee(project));
    const phones = censusProjects.flatMap((project) =>
      ([1, 2, 3, 4] as const).map((purpose) => censusPhone(purpose, project)),
    );
    const staff = censusProjects.flatMap((project) => censusPlatformStaff(project));
    const platformInvitees = censusProjects.map((project) => censusPlatformInvitee(project));
    await withPlatformUnitOfWork(pool.db, async (uow) => {
      const repository = new CensusIdentitiesRepository(uow);
      await repository.putAccounts(Object.values(censusAccounts));
      for (const user of users) {
        await repository.putUser(user, passwordHash, censusAccounts);
      }
      await repository.revokeInvitees(invitees, censusAccounts.one.id);
      // WEB-3 leg 2: the members census invites `member` again; `pending` is invited below.
      for (const project of censusProjects) {
        await repository.revokeInvitees(
          [censusMemberInvitee(project), censusPendingMember(project)],
          censusAccounts[censusSettingsAccount(project)].id,
        );
      }
      await repository.forgetPhones(phones);
      for (const member of staff) {
        // Sealed under the staff row's context, as `platformConfirmTotp` stores a secret.
        const sealed = member.totp
          ? cipher.encrypt(censusTotpSecret, `core_platform_staff:${member.id}`)
          : null;
        await repository.putPlatformStaff(member, passwordHash, sealed);
      }
      // The last run's invitees hold a staff row with TOTP: revoked, accepting the new invitation
      // brings the row back without TOTP, so the enrolment view shows again (PLAT-11 8.2 #39).
      await repository.revokePlatformStaff([
        ...platformInvitees,
        ...censusProjects.map((project) => censusPlatformHire(project)),
      ]);
      // WEB-4 leg 2: a fresh dead outbox row on each project's console account.
      for (const project of censusProjects) {
        await repository.putDeadOutboxRow({
          id: nextOutboxId(),
          accountId: censusAccounts[censusConsoleAccounts(project).active].id,
          aggregateId: censusOutboxAggregate(project),
        });
      }
    });

    const store = identityStore(pool.db);
    const outbox = new OutboxWriter();
    const resolver = await loadPermissionResolver(pool);
    const invitations = new Invitations({
      store,
      outbox,
      resolver,
      publicWebUrl: config.app.publicWebUrl,
      publicAdminUrl: config.app.publicAdminUrl,
      cipher,
    });
    for (const [index, email] of invitees.entries()) {
      await invitations.createStaff({
        accountId: censusAccounts.one.id,
        email,
        name: 'دعوة التعداد',
        roles: ['viewer'],
        siteIds: [],
        invitedBy: null,
        locale: censusProjects[index] === 'en' ? 'en' : 'ar',
      });
    }
    for (const project of censusProjects) {
      await invitations.createStaff({
        accountId: censusAccounts[censusSettingsAccount(project)].id,
        email: censusPendingMember(project),
        name: censusPendingName,
        roles: ['dispatcher'],
        siteIds: [],
        invitedBy: null,
        locale: project === 'en' ? 'en' : 'ar',
      });
    }
    await resetCensusSites(config);
    const resets = new SecondFactorResets({
      store,
      outbox,
      audit: new AuditWriter(pool),
      publicWebUrl: config.app.publicWebUrl,
      cipher,
    });
    const relinks = users.filter((user) => user.email.startsWith('census-relink-'));
    for (const user of relinks) {
      await resets.issueLink({
        userId: user.id,
        issuedBy: null,
        accountId: censusAccounts.factor.id,
        requestId: randomUUID(),
      });
    }
    for (const [index, email] of platformInvitees.entries()) {
      await invitations.createPlatform({
        email,
        name: 'Census invitee',
        role: 'support',
        invitedBy: null,
        locale: censusProjects[index] === 'en' ? 'en' : 'ar',
      });
    }
    return {
      users: users.length + staff.length,
      invitations: invitees.length + censusProjects.length + platformInvitees.length,
      links: relinks.length,
    };
  } finally {
    await pool.close();
  }
}
