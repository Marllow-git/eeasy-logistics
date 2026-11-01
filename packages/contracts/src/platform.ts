// The platform surface (PLAT-15 plan 2.7): model types, the fetch client, Zod schemas, TanStack
// Query hooks. Generated into generated/platform/ by `pnpm --filter contracts build`; never edited.
export type * from '../generated/platform/model/index.ts';
export * as client from '../generated/platform/client.ts';
export * as schemas from '../generated/platform/schemas.ts';
export * as hooks from '../generated/platform/hooks.ts';
// Plan 2.12: each operation's strict request schemas and per-status response schemas by operationId.
export { operationSchemas, type OperationId } from '../generated/platform/operations.ts';
