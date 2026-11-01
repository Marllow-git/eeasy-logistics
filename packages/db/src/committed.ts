// Committed side effects (PLAT-6 adversary M-5, ruled; PLAT-7 plan 2.4): a write that must survive
// whatever happens to the request that caused it, such as the audit row of a refused request or a
// security counter (PLAT-11). The request's own transaction rolls back on every 4xx, so these
// writes run on a transaction of their own. The apps/api architecture test allows this entry only
// from `modules/kernel/audit/` (and, later, PLAT-11's counters).
import type { Pool } from './pools.ts';
import type { PlatformDatabase, PlatformUnitOfWork } from './platform.ts';
import { withPlatformUnitOfWork } from './platform.ts';

export type { PlatformDatabase, PlatformUnitOfWork } from './platform.ts';
export type { Pool } from './pools.ts';

/**
 * Runs `fn` in a new transaction on the `elx_platform` pool, opened outside the caller's frame, and
 * commits it when `fn` resolves, whatever the caller's own transaction does afterwards. The
 * transaction is on another pooled connection and never carries the request's `elx.account_id`:
 * no setting is made, and `fn` runs in a frame of its own (no request context, no tenant unit of
 * work), so only `PlatformRepository` code with explicit predicates can write there. It must not
 * be awaited while the caller holds the only connection of the same pool.
 */
export function withCommittedSideEffect<T>(
  pool: Pool<PlatformDatabase>,
  fn: (uow: PlatformUnitOfWork) => Promise<T>,
): Promise<T> {
  return withPlatformUnitOfWork(pool.db, fn, null);
}
