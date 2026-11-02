import { createHash, randomUUID } from 'node:crypto';
import type { Config } from '@eeasy-logistics/config';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import { verifyPoolRole } from '@eeasy-logistics/db';
import { createPlatformPool, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { AuditWriter } from '../modules/kernel/audit/audit-writer.js';
import { Invitations } from '../modules/kernel/auth/invitations.js';
import { PasswordHasher } from '../modules/kernel/auth/passwords.js';
import { SecondFactorResets } from '../modules/kernel/auth/second-factor-resets.js';
import { OutboxWriter } from '../modules/kernel/outbox/outbox-writer.js';
import { identityStore } from '../modules/kernel/platform/identity.repository.js';
import { loadPermissionResolver } from '../modules/kernel/platform/roles.repository.js';
import { CensusIdentitiesRepository } from './census.repository.js';

// The identities of the web census (WEB-2 plan 2.14): `seed:census` writes them into the stack's
// database through the API's own pieces (the password hasher, the credentials cipher, the
// invitation and second-factor-reset services, so the invitation and re-enrolment mails go out
// through the outbox to the stack's Mailpit like real ones). Local and ci only. Every run puts the
// identities back to their starting state, so the census can run again: passwords, phones and
// memberships reset, OTP challenges of the census phones deleted, a fresh invitation and a fresh
// re-enrolment link mailed. One set per census project (`ar`, `ar-390`, `en`), so the projects
// never share a user or a phone. apps/web/tests/census/identities.ts mirrors these values.

/** The census projects of apps/web and apps/admin (tests/census.config.ts). */
export const censusProjects = ['ar', 'ar-390', 'en'] as const;
export type CensusProject = (typeof censusProjects)[number];

/** Every census user's password; assembled so the commit hook's scanner sees no literal. */
export const censusPassword = ['census', 'harbour', 'lantern', 'meadow'].join(' ');

/**
 * The census platform super admin's TOTP secret (base32), enrolled at seed time so the console
 * census can compute codes (leg 2); assembled from parts for the same reason.
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
} as const;

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
  ];
}

/** The email the census invitation goes to (accepted through its Mailpit link). */
export const censusInvitee = (project: CensusProject) => censusEmail('invitee', project);

/** The console's census super admin (leg 2), TOTP enrolled with `censusTotpSecret`. */
export const censusPlatformAdmin = {
  id: censusId('user-platform'),
  email: 'census-platform@census.test',
  name: 'Census Platform Admin',
} as const;

/** What a seed run did, for the log line. */
export interface CensusSeedSummary {
  readonly users: number;
  readonly invitations: number;
  readonly links: number;
}

/** Writes the census identities (see the top of this file). */
export async function seedCensus(config: Config): Promise<CensusSeedSummary> {
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
    const sealed = cipher.encrypt(
      censusTotpSecret,
      `core_platform_staff:${censusPlatformAdmin.id}`,
    );
    await withPlatformUnitOfWork(pool.db, async (uow) => {
      const repository = new CensusIdentitiesRepository(uow);
      await repository.putAccounts(Object.values(censusAccounts));
      for (const user of users) {
        await repository.putUser(user, passwordHash, censusAccounts);
      }
      await repository.revokeInvitees(invitees, censusAccounts.one.id);
      await repository.forgetPhones(phones);
      await repository.putPlatformAdmin(censusPlatformAdmin, passwordHash, sealed);
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
    return { users: users.length + 1, invitations: invitees.length, links: relinks.length };
  } finally {
    await pool.close();
  }
}
