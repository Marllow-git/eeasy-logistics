// Test-only helpers (PLAT-5 plan 2.5; PLAT-6): a context setter, and the raw transaction of a unit
// of work, which the database tests use to prove the setting, the policies and the triggers. The
// apps/api architecture test forbids importing this entry from `src/`, so no handler reaches the
// raw transaction (PLAT-5 review M-1).
export { runWithContext } from './context.ts';
export { transactionOf, type Transaction } from './unit-of-work.ts';
