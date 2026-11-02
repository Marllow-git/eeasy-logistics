import type { ExecutionContext, PipeTransform } from '@nestjs/common';
// eslint-disable-next-line no-restricted-imports -- @Input() is the API's one parameter decorator; it hands the raw request to the ContractPipe (A-17)
import { Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { ZodType, core, output } from 'zod';
import type { FieldProblem } from '../errors/api-exception.js';
import { ApiException } from '../errors/api-exception.js';
import { decodedHeaderReason, supportReasonHeader } from '../tenancy/cross-tenant.js';

// API input comes only through the contract (PLAT-6 item I; roadmap A-17; contracts README §9
// "API input", §4 "Error model"). A controller names its operation's generated schemas with
// `@Operation(operationSchemas.<operationId>)`, imported from its own surface entry point of
// `@eeasy-logistics/contracts`, and takes its input with `@Input()`. The global `ContractPipe`
// parses path parameters, query, the declared headers and the body with those strict schemas
// (an undeclared field such as `account_id` is refused, K-3; query and path values coerced) and
// answers `400 validation_failed` with `details.fields[]` JSON pointers. The kernel itself never
// imports the contracts package (contract code stops at controllers and presenters).

/** The request schemas of one operation, as `operationSchemas[operationId]` holds them. */
export interface OperationSchemas {
  /**
   * The operation's identity as generated from the contract (PLAT-10 plan 2.2): its id, surface
   * and `x-permission`. The permission guard reads them; a handler never names a permission.
   */
  readonly operationId?: string;
  readonly surface?: string;
  readonly permission?: string;
  readonly crossTenant?: boolean;
  readonly params?: ZodType;
  readonly query?: ZodType;
  readonly header?: ZodType;
  readonly body?: ZodType;
  /** Per-status response schemas; the pipe ignores them (tests parse responses with them). */
  readonly responses?: unknown;
}

type Parsed<S, K extends keyof OperationSchemas> = S extends { readonly [P in K]: infer T }
  ? T extends ZodType
    ? output<T>
    : never
  : undefined;

/** What `@Input()` hands the handler: each part parsed, `undefined` where none is declared. */
export interface ContractInput<S extends OperationSchemas> {
  readonly params: Parsed<S, 'params'>;
  readonly query: Parsed<S, 'query'>;
  readonly headers: Parsed<S, 'header'>;
  readonly body: Parsed<S, 'body'>;
}

/** The top-level fields each parsed input's body was sent with (`sentBodyFields`). */
const sentFields = new WeakMap<object, readonly string[]>();

/**
 * The top-level fields the client sent in the JSON object body of `input` (PLAT-12 plan 2.3), empty
 * for any other body. The generated schemas fill a contract `default` for an absent field, so a
 * PATCH merge tells "sent" from "absent" here, never from `input.body`. Every field named here
 * passed the operation's strict schema.
 */
export function sentBodyFields(input: object): readonly string[] {
  return sentFields.get(input) ?? [];
}

const OPERATION = Symbol('elx:operation');
const rawInput = Symbol('elx:raw-input');

interface RawInput {
  readonly [rawInput]: true;
  readonly schemas: OperationSchemas;
  readonly params: unknown;
  readonly query: unknown;
  readonly headers: Request['headers'];
  readonly body: unknown;
}

/** Binds a handler to its contract operation: `@Operation(operationSchemas.platformListAccounts)`. */
export const Operation = (schemas: OperationSchemas): MethodDecorator =>
  SetMetadata(OPERATION, schemas);

/** The operation a handler is bound to with `@Operation()`, if any. */
export function operationOf(handler: object): OperationSchemas | undefined {
  return Reflect.getMetadata(OPERATION, handler) as OperationSchemas | undefined;
}

/** The handler's input, parsed by `ContractPipe` with the schemas of its `@Operation()`. */
export const Input = createParamDecorator((_data: unknown, context: ExecutionContext): RawInput => {
  const schemas = Reflect.getMetadata(OPERATION, context.getHandler()) as
    OperationSchemas | undefined;
  if (schemas === undefined) {
    throw new Error(
      `@Input() needs @Operation() on ${context.getClass().name}.${context.getHandler().name}`,
    );
  }
  const request = context.switchToHttp().getRequest<Request>();
  return {
    [rawInput]: true,
    schemas,
    params: request.params,
    query: request.query,
    headers: request.headers,
    body: request.body as unknown,
  };
});

function isRawInput(value: unknown): value is RawInput {
  return typeof value === 'object' && value !== null && rawInput in value;
}

/** RFC 6901 escaping of one reference token. */
function token(segment: PropertyKey): string {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let value = input;
  for (const segment of path) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<PropertyKey, unknown>)[segment];
  }
  return value;
}

/** The `details.fields[]` entries of one failed part; `prefix` is `/path`, `/query`, ... */
export function fieldProblems(
  prefix: string,
  input: unknown,
  issues: readonly core.$ZodIssue[],
): FieldProblem[] {
  const problems: FieldProblem[] = [];
  for (const issue of issues) {
    const at = `${prefix}${issue.path.map((segment) => `/${token(segment)}`).join('')}`;
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys)
        problems.push({ pointer: `${at}/${token(key)}`, code: 'invalid' });
    } else if (issue.code === 'too_big' && issue.origin === 'string') {
      problems.push({ pointer: at, code: 'too_long' });
    } else if (issue.code === 'invalid_type' && valueAt(input, issue.path) === undefined) {
      problems.push({ pointer: at, code: 'required' });
    } else {
      problems.push({ pointer: at, code: 'invalid' });
    }
  }
  return problems;
}

/**
 * The declared headers of the request, looked up case-insensitively (Node lowercases incoming
 * names; the generated schema keeps the YAML spelling, `Idempotency-Key`). Undeclared headers are
 * never passed on.
 */
function declaredHeaders(schema: ZodType, headers: Request['headers']): Record<string, unknown> {
  const shape = (schema as { shape?: Record<string, unknown> }).shape ?? {};
  const picked: Record<string, unknown> = {};
  for (const name of Object.keys(shape)) {
    const value = headers[name.toLowerCase()];
    if (value !== undefined) picked[name] = contractHeaderValue(name, value);
  }
  return picked;
}

/**
 * A declared header's value as its schema reads it. `X-Support-Reason` travels percent-encoded
 * when it holds text outside Latin-1 (the `SupportReason` contract note; lead ruling on WEB-4
 * 8.2 #5): its length bounds apply to the decoded text, as the door's do (`cross-tenant.ts`).
 */
export function contractHeaderValue(name: string, value: string | string[]): string | string[] {
  return name.toLowerCase() === supportReasonHeader && typeof value === 'string'
    ? decodedHeaderReason(value)
    : value;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === 'object' && Object.keys(value).length === 0;
}

/** Parses every part of a raw input; throws `400 validation_failed` with every field at fault. */
export function parseContractInput(raw: RawInput): ContractInput<OperationSchemas> {
  const { schemas } = raw;
  const problems: FieldProblem[] = [];
  const parse = (prefix: string, schema: ZodType | undefined, value: unknown): unknown => {
    if (schema === undefined) {
      // Nothing declared: any value at all is undeclared input (a query or a body). Header
      // pointers use the lowercase wire name, like every other `/header/...` pointer.
      if (!isEmpty(value)) {
        if (typeof value === 'object' && value !== null) {
          for (const key of Object.keys(value)) {
            problems.push({ pointer: `${prefix}/${token(key)}`, code: 'invalid' });
          }
        } else {
          problems.push({ pointer: prefix, code: 'invalid' });
        }
      }
      return undefined;
    }
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    problems.push(...fieldProblems(prefix, value, result.error.issues));
    return undefined;
  };
  const params =
    raw.schemas.params === undefined ? undefined : parse('/path', schemas.params, raw.params);
  const query = parse('/query', schemas.query, raw.query);
  const headers =
    schemas.header === undefined
      ? undefined
      : (() => {
          const picked = declaredHeaders(schemas.header, raw.headers);
          const result = schemas.header.safeParse(picked);
          if (result.success) return result.data;
          problems.push(
            ...fieldProblems('/header', picked, result.error.issues).map((problem) => ({
              ...problem,
              pointer: problem.pointer.toLowerCase(),
            })),
          );
          return undefined;
        })();
  const body = parse('/body', schemas.body, raw.body);
  if (problems.length > 0) throw new ApiException('validation_failed', { fields: problems });
  const input = { params, query, headers, body } as ContractInput<OperationSchemas>;
  if (typeof raw.body === 'object' && raw.body !== null && !Array.isArray(raw.body)) {
    sentFields.set(input, Object.freeze(Object.keys(raw.body)));
  }
  return input;
}

/**
 * The global pipe (`APP_PIPE` in `KernelModule`). It acts on `@Input()` only and hands every other
 * argument on unchanged (the test-only probe routes of the request frame have no operation).
 */
@Injectable()
export class ContractPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return isRawInput(value) ? parseContractInput(value) : value;
  }
}
