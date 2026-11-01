// The server-safe staff entry (PLAT-6 review round 2, A-17): model types and enum constants, the Zod
// schemas and `operationSchemas`; no fetch client, no hooks, no MSW, so `apps/api` controllers and
// presenters can import it at run time without browser or test dependencies. Generated into
// generated/staff/ by `pnpm --filter contracts build`; never edited.
export * from '../../generated/staff/model/index.ts';
export * as schemas from '../../generated/staff/schemas.ts';
export { operationSchemas, type OperationId } from '../../generated/staff/operations.ts';
