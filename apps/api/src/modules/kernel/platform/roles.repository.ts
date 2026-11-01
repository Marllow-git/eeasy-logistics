import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase, PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { eq } from 'drizzle-orm';
import type { RoleBundle } from '../authz/permission-resolver.js';
import { PermissionResolver } from '../authz/permission-resolver.js';
import { coreRoles } from '../schema/roles.js';

/** Platform reads of `core_roles` (PLAT-10 plan 2.4); the runtime roles may only read it. */
export class RolesDirectory extends PlatformRepository<typeof coreRoles> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreRoles);
  }

  /** The system bundles (wave 0 has no custom roles). */
  async systemBundles(): Promise<RoleBundle[]> {
    const rows = await this.unscoped()
      .select({
        key: coreRoles.key,
        surface: coreRoles.surface,
        siteScoped: coreRoles.siteScoped,
        permissions: coreRoles.permissions,
      })
      .from(coreRoles)
      .where(eq(coreRoles.custom, false));
    return rows.map((row) => ({ ...row, permissions: new Set(row.permissions) }));
  }
}

/**
 * The permission resolver over core_roles, read once at boot (plan 2.4). Without the platform
 * pool (allowed outside production) there is none and every role-checked operation answers 500;
 * a failed read (no core_roles table: the database is behind the build) fails the boot.
 */
export async function loadPermissionResolver(
  pool: Pool<PlatformDatabase> | null | undefined,
): Promise<PermissionResolver | undefined> {
  if (pool === null || pool === undefined) return undefined;
  const bundles = await withPlatformUnitOfWork(pool.db, (uow) =>
    new RolesDirectory(uow).systemBundles(),
  );
  return new PermissionResolver(bundles);
}
