import type * as ConfigNode from '@eeasy-logistics/config/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CensusSeed from '../src/seed/census.js';
import {
  censusPlatformInvitee,
  censusPlatformStaff,
  censusProjects,
  censusSeedRefusal,
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
