import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import { verifyPoolRole } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_POOL } from '../../../database/database.module.js';
import { PLATFORM_POOL } from './tokens.js';

// Boot role checks (PLAT-6 plan 2.12; PLAT-5 §9 ruling M-6): before the API or a worker serves
// anything, each configured pool must log in as its plain role (no superuser, no BYPASSRLS, no
// membership in elx_owner). A mismatch refuses to start: main.ts exits 78 naming the role, never
// the URL.

export type PoolRole = 'elx_app' | 'elx_platform';

export interface PoolCheck {
  readonly role: PoolRole;
  verify(): Promise<void>;
}

/** The roles whose check failed (pure orchestration, unit-tested). */
export async function failingPoolRoles(checks: readonly PoolCheck[]): Promise<PoolRole[]> {
  const results = await Promise.all(
    checks.map(async (check) => {
      try {
        await check.verify();
        return undefined;
      } catch {
        return check.role;
      }
    }),
  );
  return results.filter((role): role is PoolRole => role !== undefined);
}

/** Thrown at boot when a pool is not what it claims; the message names roles only. */
export class BootRefusal extends Error {
  readonly roles: readonly PoolRole[];

  constructor(roles: readonly PoolRole[]) {
    super(`Refusing to start: not a plain ${roles.join(' and ')} connection`);
    this.name = 'BootRefusal';
    this.roles = roles;
  }
}

@Injectable()
export class BootChecks {
  constructor(
    @Optional() @Inject(APP_POOL) private readonly appPool?: Pool<AppDatabase> | null,
    @Optional()
    @Inject(PLATFORM_POOL)
    private readonly platformPool?: Pool<PlatformDatabase> | null,
  ) {}

  /** The checks of the configured pools; a pool left unconfigured (outside production) has none. */
  checks(): PoolCheck[] {
    const checks: PoolCheck[] = [];
    const app = this.appPool;
    const platform = this.platformPool;
    if (app) checks.push({ role: 'elx_app', verify: () => verifyPoolRole(app.db, 'elx_app') });
    if (platform) {
      checks.push({
        role: 'elx_platform',
        verify: () => verifyPoolRole(platform.db, 'elx_platform'),
      });
    }
    return checks;
  }

  /** Resolves when every configured pool is its plain role; throws `BootRefusal` otherwise. */
  async run(): Promise<void> {
    const failing = await failingPoolRoles(this.checks());
    if (failing.length > 0) throw new BootRefusal(failing);
  }
}
