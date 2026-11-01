// The recipient surface (PLAT-15 plan 2.7): model types, the fetch client and Zod schemas.
// Generated into generated/recipient/ by `pnpm --filter contracts build`; never edited.
export type * from '../generated/recipient/model/index.ts';
export * as client from '../generated/recipient/client.ts';
export * as schemas from '../generated/recipient/schemas.ts';
// Plan 2.12: each operation's strict request schemas and per-status response schemas by operationId.
export { operationSchemas, type OperationId } from '../generated/recipient/operations.ts';
