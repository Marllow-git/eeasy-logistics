import type { OnApplicationBootstrap } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { surfaceOf } from '../auth/surfaces.js';
import type { OperationSchemas } from '../contract/contract-pipe.js';
import { operationOf } from '../contract/contract-pipe.js';
import { CROSS_TENANT, IS_PUBLIC } from '../tenancy/frame.js';

/** A handler's operation as the contracts build generates it. */
export interface BoundOperation {
  readonly operationId: string;
  readonly surface: string;
  readonly permission: string;
  /** `x-cross-tenant: true`: the handler must be (and only then may be) `@CrossTenant()`. */
  readonly crossTenant: boolean;
}

/**
 * The doors of contracts README §1: no role check, open to any principal of the operation's
 * surface. A `@Public()` handler on a surface binds one of them (adversary A-1).
 */
export const doorPermissions: ReadonlySet<string> = new Set([
  'core.auth.anonymous',
  'core.auth.self',
  'platform.auth.self',
]);

/**
 * The brand the contracts build puts on every generated `operationSchemas` entry: a
 * non-enumerable property holding its operationId, which a spread copy does not carry (adversary
 * A-4; `packages/contracts/scripts/operations.ts`).
 */
export const contractOperationBrand = Symbol.for('elx.contract-operation');

const permissionPattern = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;

/**
 * The operation of `@Operation()` when it is a generated `operationSchemas` entry: frozen, branded
 * with its own operationId, with a string surface, a well-formed permission and a boolean
 * cross-tenant flag (PLAT-10 plan 2.2). A hand-built, spread or re-frozen copy is refused, so the
 * permission cannot come from the handler.
 */
export function boundOperation(schemas: OperationSchemas | undefined): BoundOperation | undefined {
  if (schemas === undefined || !Object.isFrozen(schemas)) return undefined;
  const { operationId, surface, permission, crossTenant } = schemas;
  if (typeof operationId !== 'string' || operationId === '') return undefined;
  const brand = Object.getOwnPropertyDescriptor(schemas, contractOperationBrand);
  if (brand === undefined || brand.enumerable === true || brand.value !== operationId) {
    return undefined;
  }
  if (typeof surface !== 'string' || typeof permission !== 'string') return undefined;
  if (typeof crossTenant !== 'boolean' || !permissionPattern.test(permission)) return undefined;
  return { operationId, surface, permission, crossTenant };
}

function paths(value: unknown): string[] {
  if (value === undefined) return [''];
  return (Array.isArray(value) ? value : [value]).map((path) => String(path));
}

/** The route templates of a handler: each controller path joined with each method path. */
export function routeTemplates(controllerPath: unknown, methodPath: unknown): string[] {
  return paths(controllerPath).flatMap((base) =>
    paths(methodPath).map(
      (own) =>
        `/${[base, own]
          .map((part) => part.replace(/^\/+|\/+$/g, ''))
          .filter(Boolean)
          .join('/')}`,
    ),
  );
}

/** Method names along the prototype chain (inherited handlers count, as in IdempotentRoutesCheck). */
function methodNames(prototype: object): Set<string> {
  const names = new Set<string>();
  for (
    let current: object | null = prototype;
    current !== null && current !== Object.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name !== 'constructor') names.add(name);
    }
  }
  return names;
}

/**
 * Boot check (PLAT-10 plan 2.5; adversary A-1, A-3, A-4). Every route handler on a surface binds a
 * generated operation of that surface with `@Operation(operationSchemas.<id>)`:
 * - a handler that is not `@Public()` binds any operation of its surface;
 * - a `@Public()` handler on a surface binds a door (`core.auth.anonymous`, `core.auth.self`,
 *   `platform.auth.self`), so `@Public()` never opens a role-checked operation;
 * - `@CrossTenant()` is present exactly when the operation is `x-cross-tenant`.
 * A non-public handler outside every surface is refused too; public routes outside the surfaces
 * (`/health`, `/ready`) are left alone. A refusal fails application start, naming the handler.
 */
@Injectable()
export class OperationRoutesCheck implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const refused: string[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const type = wrapper.metatype as (new (...args: never[]) => unknown) | null | undefined;
      if (typeof type !== 'function') continue;
      const controllerPath: unknown = this.reflector.get(PATH_METADATA, type);
      const classPublic = this.reflector.get<boolean | undefined>(IS_PUBLIC, type) === true;
      const prototype = type.prototype as Record<string, unknown>;
      for (const name of methodNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function') continue;
        if (this.reflector.get(METHOD_METADATA, handler) === undefined) continue; // not a route
        const isPublic = this.reflector.get<boolean | undefined>(IS_PUBLIC, handler) ?? classPublic;
        const methodPath: unknown = this.reflector.get(PATH_METADATA, handler);
        const surfaces = routeTemplates(controllerPath, methodPath).map((template) =>
          surfaceOf(template.toLowerCase()),
        );
        if (isPublic && surfaces.every((surface) => surface === undefined)) continue;
        const problem = this.problem(handler as (...args: never[]) => unknown, isPublic, surfaces);
        if (problem !== undefined) refused.push(`${type.name}.${name} (${problem})`);
      }
    }
    if (refused.length > 0) {
      throw new Error(`Handlers without a contract operation: ${refused.join(', ')}`);
    }
  }

  private problem(
    handler: (...args: never[]) => unknown,
    isPublic: boolean,
    surfaces: readonly (string | undefined)[],
  ): string | undefined {
    const operation = boundOperation(operationOf(handler));
    if (operation === undefined) return 'no generated operation';
    if (surfaces.some((surface) => surface !== operation.surface)) {
      return `${operation.operationId} is a ${operation.surface} operation`;
    }
    if (isPublic && !doorPermissions.has(operation.permission)) {
      return `@Public() on ${operation.operationId}, which is not a door`;
    }
    const crossTenant = this.reflector.get(CROSS_TENANT, handler) !== undefined;
    if (crossTenant !== operation.crossTenant) {
      return operation.crossTenant
        ? `${operation.operationId} is x-cross-tenant: it needs @CrossTenant()`
        : `@CrossTenant() on ${operation.operationId}, which is not x-cross-tenant`;
    }
    return undefined;
  }
}
