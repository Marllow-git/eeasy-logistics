// The staff surface (PLAT-15 plan 2.7): model types, the fetch client, Zod schemas, TanStack Query
// hooks. Generated into generated/staff/ by `pnpm --filter contracts build`; never edited.
export type * from '../generated/staff/model/index.ts';
export * as client from '../generated/staff/client.ts';
export * as schemas from '../generated/staff/schemas.ts';
export * as hooks from '../generated/staff/hooks.ts';
// Plan 2.12: each operation's strict request schemas and per-status response schemas by operationId.
export { operationSchemas, type OperationId } from '../generated/staff/operations.ts';
