// The server-safe driver entry (PLAT-6 review round 2, A-17): model types and enum constants, the Zod
// schemas and `operationSchemas`; no fetch client, no hooks, no MSW, so `apps/api` controllers and
// presenters can import it at run time without browser or test dependencies. Generated into
// generated/driver/ by `pnpm --filter contracts build`; never edited.
export * from '../../generated/driver/model/index.ts';
export * as schemas from '../../generated/driver/schemas.ts';
export { operationSchemas, type OperationId } from '../../generated/driver/operations.ts';
