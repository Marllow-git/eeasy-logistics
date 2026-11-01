import type { OnApplicationBootstrap } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { surfaceOf } from '../auth/surfaces.js';
import type { OperationSchemas } from '../contract/contract-pipe.js';
import { operationOf } from '../contract/contract-pipe.js';
import { IS_PUBLIC } from '../tenancy/frame.js';

/** A handler's operation as the contracts build generates it: id, surface and permission. */
export interface BoundOperation {
  readonly operationId: string;
  readonly surface: string;
  readonly permission: string;
}

const permissionPattern = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;

/**
 * The operation of `@Operation()` when it is a generated `operationSchemas` entry: frozen, with a
 * string id, surface and well-formed permission (PLAT-10 plan 2.2). A hand-built or spread copy is
 * not frozen and is refused, so the permission cannot come from the handler.
 */
export function boundOperation(schemas: OperationSchemas | undefined): BoundOperation | undefined {
  if (schemas === undefined || !Object.isFrozen(schemas)) return undefined;
  const { operationId, surface, permission } = schemas;
  if (typeof operationId !== 'string' || operationId === '') return undefined;
  if (typeof surface !== 'string' || typeof permission !== 'string') return undefined;
  if (!permissionPattern.test(permission)) return undefined;
  return { operationId, surface, permission };
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
 * Boot check (PLAT-10 plan 2.5): every route handler that is not `@Public()` binds a generated
 * operation with `@Operation(operationSchemas.<id>)`, of the surface its route is on. A handler
 * without one, with a hand-built one, outside every surface or on another surface's route fails
 * application start, naming the handler; so no route serves without a contract permission.
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
        const handlerPublic = this.reflector.get<boolean | undefined>(IS_PUBLIC, handler);
        if (handlerPublic ?? classPublic) continue;
        const where = `${type.name}.${name}`;
        const operation = boundOperation(operationOf(handler));
        if (operation === undefined) {
          refused.push(`${where} (no generated operation)`);
          continue;
        }
        const methodPath: unknown = this.reflector.get(PATH_METADATA, handler);
        for (const template of routeTemplates(controllerPath, methodPath)) {
          const surface = surfaceOf(template.toLowerCase());
          if (surface !== operation.surface) {
            refused.push(`${where} (${operation.operationId} is a ${operation.surface} operation)`);
            break;
          }
        }
      }
    }
    if (refused.length > 0) {
      throw new Error(`Handlers without a contract operation: ${refused.join(', ')}`);
    }
  }
}
