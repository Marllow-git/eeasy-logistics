// The server-safe platform entry (PLAT-6 review round 2, A-17): model types and enum constants, the Zod
// schemas and `operationSchemas`; no fetch client, no hooks, no MSW, so `apps/api` controllers and
// presenters can import it at run time without browser or test dependencies. Generated into
// generated/platform/ by `pnpm --filter contracts build`; never edited.
export * from '../../generated/platform/model/index.ts';
export * as schemas from '../../generated/platform/schemas.ts';
export {
  operationSchemas,
  operationPermissions,
  crossTenantOperations,
  type OperationId,
} from '../../generated/platform/operations.ts';
