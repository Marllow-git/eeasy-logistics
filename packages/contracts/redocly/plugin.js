// Repository lint rules for the API contracts (document 3 §9, PLAT-15 plan 2.1). Loaded by
// docs/contracts/redocly.yaml; each rule takes its options from that file.
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const writeMethods = ['post', 'put', 'patch', 'delete'];
const packageRoot = resolve(fileURLToPath(import.meta.url), '../..');

/** Dereferences a node that may be a `$ref`, following refs into other files. */
function deref(node, ctx) {
  return node !== null && typeof node === 'object' && '$ref' in node
    ? ctx.resolve(node).node
    : node;
}

/**
 * Every POST, PUT, PATCH and DELETE declares the `Idempotency-Key` header parameter, on the
 * operation or its path item, with `required: true`, unless its operationId is listed in `exempt`
 * (README §3).
 */
function IdempotencyKey({ exempt = [] }) {
  const exemptIds = new Set(exempt);
  return {
    PathItem: {
      enter(pathItem, ctx) {
        // Outbound webhook payloads (`webhooks:` in public.yaml) are the API's own calls, not writes
        // a client retries; the key does not apply to them.
        if (ctx.location.pointer.startsWith('#/webhooks/')) return;
        const shared = (pathItem.parameters ?? []).map((p) => deref(p, ctx));
        for (const method of writeMethods) {
          const operation = pathItem[method];
          if (operation === undefined) continue;
          if (exemptIds.has(operation.operationId)) continue;
          const own = (operation.parameters ?? []).map((p) => deref(p, ctx));
          const key = [...shared, ...own].find(
            (p) => p?.in === 'header' && p?.name?.toLowerCase() === 'idempotency-key',
          );
          const id = operation.operationId ?? '(no operationId)';
          if (key === undefined) {
            ctx.report({
              message: `${method.toUpperCase()} ${id} declares no Idempotency-Key parameter and is not in the exempt list.`,
              location: ctx.location.child([method]).key(),
            });
          } else if (key.required !== true) {
            // A missing key is `400 idempotency_key_required` (README §3), so the header is required.
            ctx.report({
              message: `${method.toUpperCase()} ${id} declares Idempotency-Key without required: true.`,
              location: ctx.location.child([method]).key(),
            });
          }
        }
      },
    },
  };
}

/** Reads the permission catalogue (`permissions: { <module>: [<permission>, ...] }`). */
export function readCatalogue(file) {
  const doc = parse(readFileSync(file, 'utf8'));
  return new Set(Object.values(doc.permissions).flat());
}

/** `x-permission` is a member of the catalogue file named by `catalogue` (relative to the package). */
function PermissionInCatalogue({ catalogue = '../../docs/contracts/permissions.yaml' }) {
  const known = readCatalogue(isAbsolute(catalogue) ? catalogue : resolve(packageRoot, catalogue));
  return {
    Operation: {
      enter(operation, ctx) {
        const permission = operation['x-permission'];
        if (permission !== undefined && !known.has(permission)) {
          ctx.report({
            message: `x-permission "${String(permission)}" is not in docs/contracts/permissions.yaml.`,
            location: ctx.location.child('x-permission'),
          });
        }
      },
    },
  };
}

/** The doors of README §1: opened by the permission guard to any principal of the surface. */
export const doorPermissions = ['core.auth.anonymous', 'core.auth.self', 'platform.auth.self'];

/** The problems of a role file (`roles: { <key>: { scope, surface, site_scoped, permissions } }`). */
export function roleFileProblems(rolesFile, catalogueFile) {
  const known = readCatalogue(catalogueFile);
  const doc = parse(readFileSync(rolesFile, 'utf8'));
  const problems = [];
  const roles = doc?.roles;
  if (roles === null || typeof roles !== 'object' || Object.keys(roles).length === 0) {
    return ['roles.yaml has no `roles` map.'];
  }
  for (const [key, role] of Object.entries(roles)) {
    if (!/^[a-z][a-z_]*$/.test(key)) problems.push(`role key "${key}" is not snake_case.`);
    if (!['account', 'platform'].includes(role?.scope)) {
      problems.push(`role ${key}: scope must be account or platform.`);
    }
    if (!['staff', 'driver', 'platform'].includes(role?.surface)) {
      problems.push(`role ${key}: surface must be staff, driver or platform.`);
    }
    if (typeof role?.site_scoped !== 'boolean') {
      problems.push(`role ${key}: site_scoped must be true or false.`);
    }
    const permissions = role?.permissions;
    if (!Array.isArray(permissions) || permissions.length === 0) {
      problems.push(`role ${key}: permissions must be a non-empty list.`);
      continue;
    }
    const seen = new Set();
    for (const permission of permissions) {
      if (seen.has(permission)) problems.push(`role ${key}: "${permission}" is listed twice.`);
      seen.add(permission);
      if (doorPermissions.includes(permission)) {
        problems.push(`role ${key}: "${permission}" is a door, not a role permission.`);
      } else if (!known.has(permission)) {
        problems.push(`role ${key}: "${String(permission)}" is not in permissions.yaml.`);
      }
    }
  }
  return problems;
}

/**
 * Every permission of every bundle in docs/contracts/roles.yaml is in the catalogue, no bundle
 * lists a door or a permission twice, and each bundle names its scope, surface and site scoping
 * (PLAT-10 plan 2.1). Not an OpenAPI rule: it runs once, on the root of the api it is enabled for
 * (`components` in redocly.yaml).
 */
function RolePermissionsInCatalogue({
  roles = '../../docs/contracts/roles.yaml',
  catalogue = '../../docs/contracts/permissions.yaml',
}) {
  const at = (file) => (isAbsolute(file) ? file : resolve(packageRoot, file));
  return {
    Root: {
      enter(_root, ctx) {
        for (const message of roleFileProblems(at(roles), at(catalogue))) {
          ctx.report({ message, location: ctx.location });
        }
      },
    },
  };
}

/** `x-wave` is an integer from 0 to 4 (README §9, §10); presence is the configurable rule's job. */
function WaveRange() {
  return {
    Operation: {
      enter(operation, ctx) {
        const wave = operation['x-wave'];
        if (wave !== undefined && !(Number.isInteger(wave) && wave >= 0 && wave <= 4)) {
          ctx.report({
            message: `x-wave must be an integer from 0 to 4, got ${JSON.stringify(wave)}.`,
            location: ctx.location.child('x-wave'),
          });
        }
      },
    },
  };
}

/**
 * An operation that answers `text/event-stream` lists its SSE event names in `x-sse-events`
 * (README §6, ADR-0029); the generated `StreamEventName` union is read from them.
 */
function SseEvents() {
  return {
    Operation: {
      enter(operation, ctx) {
        const responses = Object.values(operation.responses ?? {}).map((r) => deref(r, ctx));
        const streams = responses.some((r) => r?.content?.['text/event-stream'] !== undefined);
        const events = operation['x-sse-events'];
        const listed =
          Array.isArray(events) &&
          events.length > 0 &&
          events.every((e) => typeof e === 'string' && /^[a-z_]+(\.[a-z_]+)*(\.\*)?$/.test(e));
        if (streams && !listed) {
          ctx.report({
            message: 'A text/event-stream operation lists its event names in x-sse-events.',
            location: ctx.location.child('responses').key(),
          });
        } else if (!streams && events !== undefined) {
          ctx.report({
            message: 'x-sse-events is allowed only on text/event-stream operations.',
            location: ctx.location.child('x-sse-events'),
          });
        }
      },
    },
  };
}

export default function eeasyContractsPlugin() {
  return {
    id: 'eeasy',
    rules: {
      oas3: {
        'idempotency-key': IdempotencyKey,
        'x-wave-range': WaveRange,
        'sse-events': SseEvents,
        'permission-in-catalogue': PermissionInCatalogue,
        'role-permissions-in-catalogue': RolePermissionsInCatalogue,
      },
    },
  };
}
