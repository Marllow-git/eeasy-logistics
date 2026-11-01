// The driver surface (PLAT-15 plan 2.7): model types, the fetch client and Zod schemas; no hooks
// and no MSW, so the driver app pulls in no browser-only code (driver app §1). Generated into
// generated/driver/ by `pnpm --filter contracts build`; never edited.
export type * from '../generated/driver/model/index.ts';
export * as client from '../generated/driver/client.ts';
export * as schemas from '../generated/driver/schemas.ts';
// Plan 2.12: each operation's strict request schemas and per-status response schemas by operationId.
export { operationSchemas, type OperationId } from '../generated/driver/operations.ts';
