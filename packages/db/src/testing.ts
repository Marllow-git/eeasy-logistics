// Test-only helpers (PLAT-5 plan 2.5): the request guard that fills the context from a token is
// PLAT-6's, so tests set the context here. The apps/api architecture test forbids importing this
// entry from `src/`.
export { runWithContext } from './context.ts';
