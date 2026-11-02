import type { Config } from '@eeasy-logistics/config';
import type * as ConfigNode from '@eeasy-logistics/config/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CensusSeed from '../src/seed/census.js';
import type { CensusAccountKey } from '../src/seed/census.js';
import {
  censusAccounts,
  censusConsoleAccounts,
  censusMemberInvitee,
  censusPendingMember,
  censusPlatformInvitee,
  censusOutboxAggregate,
  censusPlatformHire,
  censusPlatformRoleOf,
  censusPlatformStaff,
  censusProjects,
  censusSeedRefusal,
  censusSettingsAccount,
  censusSites,
  censusUsers,
  seedCensus,
} from '../src/seed/census.js';

// WEB-2 (lead ruling on leg 1): `seed:census` writes known passwords and a known TOTP secret, so it
// refuses any environment but local and ci with one line and a non-zero exit, before it reads the
// rest of the configuration or opens a pool.

class Exit extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`exit ${String(code)}`);
  }
}

describe('censusSeedRefusal', () => {
  it('lets local and ci run', () => {
    expect(censusSeedRefusal('local')).toBeUndefined();
    expect(censusSeedRefusal('ci')).toBeUndefined();
  });

  it.each(['staging', 'production', 'dev', ''])('refuses APP_ENV=%s with one line', (appEnv) => {
    const refusal = censusSeedRefusal(appEnv);
    expect(refusal).toMatch(/^seed:census refuses to run with APP_ENV=.*: local or ci only$/);
    expect(refusal).not.toContain('\n');
  });

  it('refuses an unset APP_ENV', () => {
    expect(censusSeedRefusal('')).toBe(censusSeedRefusal(undefined));
    expect(censusSeedRefusal(undefined)).toBe(
      'seed:census refuses to run with APP_ENV=(unset): local or ci only',
    );
  });
});

describe('seedCensus', () => {
  it.each(['production', 'staging'])(
    'refuses APP_ENV=%s itself, whoever calls it, before it touches the credentials or a pool',
    async (env) => {
      // Adversary L-4: the guard lives in the seed, not only in census-main.
      const config = {
        app: { env },
        credentials: { keys: 'never read' },
        db: { poolSize: { platform: 9 } },
      } as unknown as Config;
      await expect(seedCensus(config)).rejects.toThrow(censusSeedRefusal(env));
    },
  );
});

describe('census-main', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.doUnmock('@eeasy-logistics/config/node');
    vi.doUnmock('../src/seed/census.js');
    vi.resetModules();
  });

  it.each(['production', 'staging'])(
    'exits 1 with one line under APP_ENV=%s, before the configuration or the seed',
    async (appEnv) => {
      vi.stubEnv('APP_ENV', appEnv);
      const loadConfig = vi.fn();
      const seedCensus = vi.fn();
      vi.doMock('@eeasy-logistics/config/node', async (original) => ({
        ...(await original<typeof ConfigNode>()),
        loadConfig,
      }));
      vi.doMock('../src/seed/census.js', async (original) => ({
        ...(await original<typeof CensusSeed>()),
        seedCensus,
      }));
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      // eslint-disable-next-line no-restricted-syntax -- observes the refusal's exit; reads no environment
      vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Exit(code);
      });
      await expect(import('../src/seed/census-main.js')).rejects.toEqual(new Exit(1));
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(stderr).toHaveBeenCalledWith(
        `seed:census refuses to run with APP_ENV=${appEnv}: local or ci only\n`,
      );
      expect(loadConfig).not.toHaveBeenCalled();
      expect(seedCensus).not.toHaveBeenCalled();
    },
  );
});

describe('the console census staff', () => {
  it('gives every project its own users, all enrolled but the enrolment one', () => {
    const emails = censusProjects.flatMap((project) =>
      censusPlatformStaff(project).map((member) => member.email),
    );
    expect(new Set(emails).size).toBe(emails.length);
    for (const project of censusProjects) {
      const staff = censusPlatformStaff(project);
      expect(staff.filter((member) => !member.totp).map((member) => member.email)).toEqual([
        `census-platform-enrol-${project.replace('-', '')}@census.test`,
      ]);
      expect(staff.map((member) => member.email)).not.toContain(censusPlatformInvitee(project));
    }
  });
});

describe('the console census accounts and roles (WEB-4)', () => {
  it('gives each project an active, a suspended and a provisioned account of its own', () => {
    const keys = censusProjects.flatMap((project) => {
      const { active, suspended, provisioned } = censusConsoleAccounts(project);
      const status = (key: CensusAccountKey) =>
        (censusAccounts[key] as { status?: string }).status ?? 'active';
      expect([status(active), status(suspended), status(provisioned)]).toEqual([
        'active',
        'suspended',
        'provisioned',
      ]);
      return [active, suspended, provisioned];
    });
    expect(new Set(keys).size).toBe(keys.length);
    const names = keys.map((key) => censusAccounts[key].name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('seeds one admin and three support members per project, every other console user a super admin', () => {
    for (const project of censusProjects) {
      const roles = censusPlatformStaff(project).map((member) => member.role);
      expect(roles.filter((role) => role === 'admin')).toHaveLength(1);
      // `support` reads; `colleague` and `relink` are the staff census's targets (leg 2).
      expect(roles.filter((role) => role === 'support')).toHaveLength(3);
      expect(roles.filter((role) => role === 'super_admin')).toHaveLength(roles.length - 4);
    }
    expect(censusPlatformRoleOf('operator')).toBe('admin');
    expect(censusPlatformRoleOf('support')).toBe('support');
    expect(censusPlatformRoleOf('colleague')).toBe('support');
    expect(censusPlatformRoleOf('relink')).toBe('support');
    expect(censusPlatformRoleOf('accounts')).toBe('super_admin');
    expect(censusPlatformRoleOf('staff')).toBe('super_admin');
  });

  it('gives each project its own outbox aggregate and hire address', () => {
    const aggregates = censusProjects.map((project) => censusOutboxAggregate(project));
    expect(new Set(aggregates).size).toBe(censusProjects.length);
    expect(censusPlatformHire('ar-390')).toBe('census-platform-hire-ar390@census.test');
  });
});

describe('the settings census staff (WEB-3)', () => {
  it("puts each project's owner, viewer and site staff on that project's own account", () => {
    const accounts = censusProjects.map((project) => {
      const users = censusUsers(project).filter((user) =>
        ['settings', 'viewer', 'sitestaff'].some((role) =>
          user.email.startsWith(`census-${role}-`),
        ),
      );
      expect(users.map((user) => user.memberships[0]?.roles[0])).toEqual([
        'owner',
        'viewer',
        'site_staff',
      ]);
      const keys = new Set(users.flatMap((user) => user.memberships.map((m) => m.account)));
      expect(keys.size).toBe(1);
      return [...keys][0]!;
    });
    expect(new Set(accounts).size).toBe(censusProjects.length);
    for (const key of accounts) expect(censusAccounts[key].factor).toBe(false);
    for (const [index, project] of censusProjects.entries()) {
      expect(censusSettingsAccount(project)).toBe(accounts[index]);
    }
  });
});

describe('the settings census sites and members (WEB-3 leg 2)', () => {
  it('gives each project a branch and a warehouse of its own, valid for the site rules', () => {
    const ids = censusProjects.flatMap((project) => censusSites(project).map((site) => site.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const project of censusProjects) {
      const sites = censusSites(project);
      expect(sites.map((site) => site.kind)).toEqual(['branch', 'warehouse']);
      for (const site of sites) {
        // The column check of 0014 and the one-line names of PLAT-12 2.5.
        expect(site.shortCode).toMatch(/^[A-Z]{4}[0-9]{4}$/);
        expect([...site.nameAr].length).toBeLessThanOrEqual(120);
        expect(site.nameEn).not.toMatch(/[\r\n]/);
        for (const row of site.openingHours) {
          expect(row.weekday).toBeGreaterThanOrEqual(0);
          expect(row.weekday).toBeLessThanOrEqual(6);
          expect(row.opens).toMatch(/^\d{2}:\d{2}$/);
        }
      }
    }
  });

  it('invites a member and leaves one pending per project, never a seeded user', () => {
    const users = new Set(
      censusProjects.flatMap((project) => censusUsers(project).map((user) => user.email)),
    );
    const emails = censusProjects.flatMap((project) => [
      censusMemberInvitee(project),
      censusPendingMember(project),
    ]);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(users.has(email)).toBe(false);
  });
});
