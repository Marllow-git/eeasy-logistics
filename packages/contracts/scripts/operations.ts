// Runs after Orval (PLAT-15 plan 2.12, A-17). For each surface it:
// 1. replaces `zod.coerce.boolean()` with `zod.stringbool()` in generated/<surface>/schemas.ts:
//    `coerce.boolean` is `Boolean(value)`, so the query string `false` would become `true`;
//    `stringbool` reads `true`/`false` (and `1`/`0`, `yes`/`no`, `on`/`off`) and refuses the rest;
// 2. points Orval's directory imports (`from './model'`) at `./model/index.ts` in the client,
//    hooks and MSW files: Node ESM and TypeScript `NodeNext` (apps/api, PLAT-6 item I) resolve
//    no directory imports, bundlers resolve both;
// 3. writes generated/<surface>/operations.ts: `operationSchemas`, every operation of the bundle
//    keyed by operationId, with its `params`, `query`, `header`, `body` and per-status `responses`
//    schemas, so apps/api's ContractPipe (PLAT-6) finds an operation's schema by its id; each
//    entry also carries its operationId, surface and `x-permission` for the API's permission
//    guard, with `operationPermissions` and `crossTenantOperations` beside it (PLAT-10 plan 2.2).
// Run: pnpm --filter contracts build (after build:client)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedDir, surfaces } from './paths.ts';
import type { SurfaceName } from './paths.ts';

const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const parts = { Params: 'params', QueryParams: 'query', Header: 'header', Body: 'body' } as const;

export interface OperationSchemaNames {
  params?: string;
  query?: string;
  header?: string;
  body?: string;
  responses: Record<string, string>;
}

/** What the authorization of one operation needs from its bundle entry (PLAT-10 plan 2.2). */
export interface OperationAccess {
  id: string;
  /** `x-permission`: the one permission the operation requires (README §1). */
  permission: string;
  /** `x-cross-tenant: true` (platform operations that reach another account, README §1). */
  crossTenant: boolean;
}

type BundleOperation = {
  operationId?: string;
  'x-permission'?: unknown;
  'x-cross-tenant'?: unknown;
};

/** The operations of a surface bundle with `x-permission` and `x-cross-tenant`, in path order. */
export function bundleOperations(surface: SurfaceName): OperationAccess[] {
  const doc = JSON.parse(
    readFileSync(join(generatedDir, 'openapi', `${surface}.json`), 'utf8'),
  ) as { paths?: Record<string, Record<string, BundleOperation>> };
  const operations: OperationAccess[] = [];
  for (const item of Object.values(doc.paths ?? {})) {
    for (const method of methods) {
      const operation = item[method];
      const id = operation?.operationId;
      if (operation === undefined || id === undefined) continue;
      const permission = operation['x-permission'];
      // The lint rules require both; the generator refuses rather than emit an open operation.
      if (typeof permission !== 'string' || !/^[a-z]+\.[a-z_]+\.[a-z_]+$/.test(permission)) {
        throw new Error(`${surface} ${id}: x-permission missing or malformed`);
      }
      operations.push({ id, permission, crossTenant: operation['x-cross-tenant'] === true });
    }
  }
  return operations;
}

/** operationIds of a surface bundle, in path order. */
export function bundleOperationIds(surface: SurfaceName): string[] {
  return bundleOperations(surface).map((operation) => operation.id);
}

/**
 * Assigns each exported schema of `schemas.ts` to its operation by Orval's naming
 * (`<OperationId>{Params,QueryParams,Header,Body}`, `<OperationId><status>Response`). Fails when a
 * request or response schema matches no operation or more than one.
 */
export function mapOperationSchemas(
  operationIds: string[],
  exportNames: string[],
): Record<string, OperationSchemaNames> {
  const pascal = new Map(operationIds.map((id) => [`${id[0]?.toUpperCase()}${id.slice(1)}`, id]));
  const result: Record<string, OperationSchemaNames> = Object.fromEntries(
    operationIds.map((id) => [id, { responses: {} }]),
  );
  for (const name of exportNames) {
    if (!/^[A-Z]/.test(name)) continue; // lower-case exports are constants (limits, patterns)
    const owners: [string, (entry: OperationSchemaNames) => void][] = [];
    for (const [prefix, id] of pascal) {
      if (!name.startsWith(prefix)) continue;
      const suffix = name.slice(prefix.length);
      const part = Object.hasOwn(parts, suffix) ? parts[suffix as keyof typeof parts] : undefined;
      if (part !== undefined) {
        owners.push([id, (entry) => (entry[part] = name)]);
        continue;
      }
      const status = /^(\d{3}|\dXX|Default)Response$/.exec(suffix)?.[1];
      if (status !== undefined) {
        const key = status === 'Default' ? 'default' : status;
        owners.push([id, (entry) => (entry.responses[key] = name)]);
      }
    }
    if (owners.length > 1) {
      throw new Error(`${name} matches ${owners.map(([id]) => id).join(' and ')}`);
    }
    const owner = owners[0];
    if (owner === undefined) {
      // Item schemas of array bodies and responses (`...BodyItem`, `...ResponseItem`) are parts of
      // the schemas above; anything else would be a naming change in Orval.
      if (/(?:Body|Response)Item$/.test(name)) continue;
      throw new Error(`schema ${name} matches no operation`);
    }
    const entry = result[owner[0]];
    if (entry !== undefined) owner[1](entry);
  }
  return result;
}

function exportNames(source: string): string[] {
  return [...source.matchAll(/^export const ([A-Za-z0-9_]+)/gm)].map((m) => m[1] ?? '');
}

export function renderOperations(
  surface: SurfaceName,
  map: Record<string, OperationSchemaNames>,
  access: readonly OperationAccess[],
): string {
  const byId = new Map(access.map((operation) => [operation.id, operation]));
  const lines = Object.entries(map).map(([id, entry]) => {
    const operation = byId.get(id);
    if (operation === undefined) throw new Error(`${surface} ${id}: no bundle entry`);
    const fields = [
      `operationId: '${id}'`,
      `surface: '${surface}'`,
      `permission: operationPermissions.${id}`,
      `crossTenant: ${String(operation.crossTenant)}`,
      ...(['params', 'query', 'header', 'body'] as const)
        .filter((part) => entry[part] !== undefined)
        .map((part) => `${part}: schemas.${entry[part]}`),
    ];
    const responses = Object.entries(entry.responses).map(
      ([status, name]) => `'${status}': schemas.${name}`,
    );
    fields.push(`responses: { ${responses.join(', ')} }`);
    return `  ${id}: Object.freeze({ ${fields.join(', ')} }),`;
  });
  const permissions = access.map((operation) => `  ${operation.id}: '${operation.permission}',`);
  const crossTenant = access
    .filter((operation) => operation.crossTenant)
    .map((operation) => `  '${operation.id}',`);
  return `// Generated by scripts/operations.ts. Do not edit (document 3 §9).
import type { Permission } from '../unions.ts';
import * as schemas from './schemas.ts';

/**
 * The \`x-permission\` of every operation of the surface by operationId (PLAT-10 plan 2.2): the only
 * source of the permission the API's permission guard requires; no handler names one.
 */
export const operationPermissions = {
${permissions.join('\n')}
} as const satisfies Record<string, Permission>;

/** The operations declared \`x-cross-tenant: true\` (README §1). */
export const crossTenantOperations = [
${crossTenant.join('\n')}
] as const;

/**
 * Every operation of the surface by operationId: its id, surface, permission and cross-tenant flag
 * (read by the API's permission guard, PLAT-10), strict request schemas and response schemas per
 * status. Each entry is frozen: a controller binds it as generated, \`@Operation(operationSchemas.<id>)\`.
 */
export const operationSchemas = {
${lines.join('\n')}
} as const;
export type OperationId = keyof typeof operationSchemas;
`;
}

export function processSurface(surface: SurfaceName): Record<string, OperationSchemaNames> {
  const file = join(generatedDir, surface, 'schemas.ts');
  const source = readFileSync(file, 'utf8').replaceAll('zod.coerce.boolean()', 'zod.stringbool()');
  writeFileSync(file, source);
  for (const name of ['client.ts', 'hooks.ts', 'hooks.msw.ts']) {
    const path = join(generatedDir, surface, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, text.replaceAll("from './model';", "from './model/index.ts';"));
  }
  const access = bundleOperations(surface);
  const map = mapOperationSchemas(
    access.map((operation) => operation.id),
    exportNames(source),
  );
  writeFileSync(
    join(generatedDir, surface, 'operations.ts'),
    renderOperations(surface, map, access),
  );
  return map;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const { name } of surfaces) processSurface(name);
}
