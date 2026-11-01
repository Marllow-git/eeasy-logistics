import { describe, expect, it } from 'vitest';
import type { PoolCheck } from '../src/modules/kernel/platform/boot-checks.js';
import { BootRefusal, failingPoolRoles } from '../src/modules/kernel/platform/boot-checks.js';

// PLAT-6 item D, plan 2.12: the boot check refuses a pool that is not its plain role and names
// the role only (the database behaviour is in test/integration/cross-tenant.http.test.ts).

const passing = (role: PoolCheck['role']): PoolCheck => ({ role, verify: () => Promise.resolve() });
const failing = (role: PoolCheck['role']): PoolCheck => ({
  role,
  verify: () => Promise.reject(new Error('postgres://elx_app:secret@db:5432/elx')),
});

describe('boot role checks', () => {
  it('passes when every pool is its plain role', async () => {
    expect(await failingPoolRoles([passing('elx_app'), passing('elx_platform')])).toEqual([]);
  });

  it('names a wrong platform role', async () => {
    expect(await failingPoolRoles([passing('elx_app'), failing('elx_platform')])).toEqual([
      'elx_platform',
    ]);
  });

  it('refuses with the role names only, never the URL', () => {
    const refusal = new BootRefusal(['elx_app', 'elx_platform']);
    expect(refusal.message).toBe(
      'Refusing to start: not a plain elx_app and elx_platform connection',
    );
    expect(refusal.message).not.toContain('postgres://');
  });
});
