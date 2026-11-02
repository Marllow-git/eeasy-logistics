// Shared database helpers (data architecture §1.2, §4.2; ADR-0020, ADR-0031). Table declarations
// never live here: they stay private to each context in apps/api. Other entries:
//   @eeasy-logistics/db/platform   the elx_platform pool and PlatformRepository (cross-tenant)
//   @eeasy-logistics/db/migrate    the migration runner (elx_owner, the migration job only)
//   @eeasy-logistics/db/testing    a context setter and scratch-database helpers for tests
export {
  findContext,
  findPlatformContext,
  getContext,
  runWithContext,
  type PlatformContext,
  type RequestContext,
} from './context.ts';
export {
  createAppPool,
  isPlainPoolRole,
  verifyPoolRole,
  type PoolRoleFacts,
  type AppDatabase,
  type AppPoolSettings,
  type Pool,
} from './pools.ts';
export {
  ScopedRepository,
  type TenantInsert,
  type TenantTable,
  type TenantUpdate,
} from './scoped-repository.ts';
export {
  getUnitOfWork,
  UnitOfWorkClosedError,
  withUnitOfWork,
  type UnitOfWork,
} from './unit-of-work.ts';
export { isUuid, uuidv7 } from './uuid.ts';
export {
  multiPolygon,
  multiPolygonFromWkbHex,
  type MultiPolygonGeoJson,
  type Position,
} from './geometry.ts';
