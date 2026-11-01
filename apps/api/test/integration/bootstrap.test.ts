import { randomBytes } from 'node:crypto';
import type { Config } from '@eeasy-logistics/config';
import { dropDatabase, recreateDatabase } from '@eeasy-logistics/db/admin';
import { runMigrations } from '@eeasy-logistics/db/migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapExit, runBootstrap } from '../../src/bootstrap.js';
import { migrationsFolder } from '../../src/migrate/run.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-11 item H (plan 2.12, owner question 5): `--role bootstrap` invites the first super admin
// once. It refuses whenever any platform staff row exists, which the shared integration database
// always has (other files insert staff), so this file needs a database of its own: it runs only
// with DATABASE_URL_ADMIN (locally; ci's elx_owner may not create databases) and sits in the
// `migrator` project (it runs the migrator).

const admin = integrationConfig().db.urls.admin;
let config: Config = integrationConfig();
let dropOwnDatabase: () => Promise<void> = () => Promise.resolve();

beforeAll(async () => {
  if (admin === undefined) return;
  const database = `elx_test_${randomBytes(6).toString('hex')}`;
  await recreateDatabase(admin, database);
  dropOwnDatabase = () => dropDatabase(admin, database);
  config = integrationConfig({}, database);
  await runMigrations({ url: config.db.urls.owner, folder: migrationsFolder, rls: config.db.rls });
});

afterAll(() => dropOwnDatabase());

describe.skipIf(admin === undefined)('--role bootstrap (PLAT-11 item H)', () => {
  const run = async (args: string[]) => {
    const lines: string[] = [];
    const errors: string[] = [];
    const code = await runBootstrap(config, ['--role', 'bootstrap', ...args], {
      log: (line) => lines.push(line),
      error: (line) => errors.push(line),
    });
    return { code, lines, errors };
  };

  it('creates the super admin invitation once, prints the link, audits it, and refuses after', async () => {
    const owner = connectAs('owner', config);
    try {
      const usage = await run(['--email', 'root@example.test']);
      expect(usage.code).toBe(bootstrapExit.usage);

      const first = await run(['--email', 'Root@Example.Test', '--name', 'Root']);
      expect(first.code).toBe(bootstrapExit.created);
      const link = first.lines.at(-1) ?? '';
      expect(link).toMatch(/^http:\/\/localhost:3002\/invitations\/[\w-]{43}$/);
      const [invitation] = await owner<{ id: string; platform_role: string; invited_by: null }[]>`
        SELECT id, platform_role, invited_by FROM core_invitations WHERE kind = 'platform'`;
      expect(invitation).toMatchObject({ platform_role: 'super_admin', invited_by: null });
      // No mail (SMTP may not exist yet): no outbox row.
      expect(await owner`SELECT 1 FROM core_outbox WHERE kind = 'message'`).toHaveLength(0);
      const audit = await owner<{ action: string; actor_type: string; target_id: string }[]>`
        SELECT action, actor_type, target_id FROM core_audit_log
        WHERE action = 'core.platform_staff.bootstrapped'`;
      expect(audit).toEqual([
        {
          action: 'core.platform_staff.bootstrapped',
          actor_type: 'system',
          target_id: invitation?.id,
        },
      ]);

      // A live invitation refuses a second run; so does a staff row once it exists.
      const second = await run(['--email', 'other@example.test', '--name', 'Other']);
      expect(second.code).toBe(bootstrapExit.refused);
      expect(second.lines).toEqual([]);
      await owner`UPDATE core_invitations SET expires_at = now() - interval '1 second'`;
      const [user] = await owner<{ id: string }[]>`
        SELECT id FROM core_users WHERE email = 'root@example.test'`;
      await owner`INSERT INTO core_platform_staff (user_id, role) VALUES (${user?.id ?? ''}, 'super_admin')`;
      const third = await run(['--email', 'other@example.test', '--name', 'Other']);
      expect(third.code).toBe(bootstrapExit.refused);
      expect(await owner`SELECT 1 FROM core_invitations WHERE kind = 'platform'`).toHaveLength(1);
    } finally {
      await owner.end();
    }
  });
});
