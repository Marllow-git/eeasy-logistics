// The public surface (PLAT-15 plan 2.7): model types, the fetch client, Zod schemas, TanStack Query
// hooks. Generated into generated/public/ by `pnpm --filter contracts build`; never edited.
export type * from '../generated/public/model/index.ts';
export * as client from '../generated/public/client.ts';
export * as schemas from '../generated/public/schemas.ts';
export * as hooks from '../generated/public/hooks.ts';
// Plan 2.12: each operation's strict request schemas and per-status response schemas by operationId.
export { operationSchemas, type OperationId } from '../generated/public/operations.ts';
