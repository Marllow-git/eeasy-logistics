// The contract-test harness (PLAT-15 plan 2.8): checks a recorded API response against its surface
// bundle. A response fails on a status the operation does not document, a field its schema does not
// declare (reported as `undocumented_field` even where the schema leaves `additionalProperties`
// open by omission), an error `code` outside `ErrorCode`, a body that breaks the schema, a content
// type the response does not document, or a missing or malformed documented header.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { errorCodes } from '../../generated/unions.ts';
import { generatedDir } from '../../scripts/paths.ts';
import type { SurfaceName } from '../../scripts/paths.ts';

export type ViolationKind =
  | 'undocumented_status'
  | 'undocumented_field'
  | 'unknown_error_code'
  | 'schema_mismatch'
  | 'undocumented_content_type'
  | 'header_mismatch';

export interface Violation {
  kind: ViolationKind;
  /** JSON pointer into the body (`/data/0/name`), the header name, or `''`. */
  at: string;
  message: string;
}

/** One HTTP answer as the harness saw it on the wire. */
export interface RecordedResponse {
  method: string;
  url: string;
  status: number;
  headers: Headers;
  /** Parsed JSON when the content type says JSON, else the text; `undefined` when empty. */
  body: unknown;
}

type Json = Record<string, unknown>;

interface Operation {
  operationId: string;
  method: string;
  /** Path template with the server base path, e.g. `/v1/platform/accounts/{id}`. */
  path: string;
  matcher: RegExp;
  /** JSON pointer of the operation object in the bundle. */
  pointer: string;
}

const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const knownErrorCodes: ReadonlySet<string> = new Set(errorCodes);

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const escapePointer = (token: string): string => token.replace(/~/g, '~0').replace(/\//g, '~1');

// Keywords whose value is a schema or holds schemas. Anything else (examples, defaults, enums,
// extensions) is data and is copied untouched.
const locationKeywords = ['items', 'contains', 'additionalProperties', 'unevaluatedItems'];
const mapKeywords = ['properties', 'patternProperties', '$defs', 'dependentSchemas'];
const branchKeywords = ['allOf', 'anyOf', 'oneOf'];
const innerKeywords = ['not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedProperties'];

/**
 * Returns a copy of `schema` in which every schema that describes a value on its own (a response
 * root, a property, an array item) refuses properties nothing declared: `unevaluatedProperties:
 * false`, which sees through `allOf`, `oneOf`, `anyOf` and `$ref` (JSON Schema 2020-12), so a
 * composed object keeps every property its parts declare. Branches of a composition and component
 * roots stay open, since their siblings declare the rest. An explicit `additionalProperties` or
 * `unevaluatedProperties` (a documented open map) is respected.
 */
export function closeObjects(schema: unknown, atLocation: boolean): unknown {
  if (!isObject(schema)) return schema;
  const copy: Json = { ...schema };
  for (const key of locationKeywords) {
    if (isObject(copy[key])) copy[key] = closeObjects(copy[key], true);
  }
  if (Array.isArray(copy.prefixItems)) {
    copy.prefixItems = copy.prefixItems.map((item) => closeObjects(item, true));
  }
  for (const key of mapKeywords) {
    const map = copy[key];
    if (!isObject(map)) continue;
    copy[key] = Object.fromEntries(
      Object.entries(map).map(([name, sub]) => [name, closeObjects(sub, key !== '$defs')]),
    );
  }
  for (const key of branchKeywords) {
    const branches = copy[key];
    if (Array.isArray(branches)) copy[key] = branches.map((branch) => closeObjects(branch, false));
  }
  for (const key of innerKeywords) {
    if (isObject(copy[key])) copy[key] = closeObjects(copy[key], false);
  }
  const describesObject =
    '$ref' in copy ||
    'properties' in copy ||
    branchKeywords.some((key) => key in copy) ||
    copy.type === 'object' ||
    (Array.isArray(copy.type) && copy.type.includes('object'));
  if (
    atLocation &&
    describesObject &&
    !('additionalProperties' in copy) &&
    !('unevaluatedProperties' in copy)
  ) {
    copy.unevaluatedProperties = false;
  }
  return copy;
}

/** The bundle with every response schema and component schema closed (see `closeObjects`). */
function closeBundle(bundle: Json): Json {
  const copy = structuredClone(bundle);
  const components = isObject(copy.components) ? copy.components : {};
  if (isObject(components.schemas)) {
    for (const [name, schema] of Object.entries(components.schemas)) {
      components.schemas[name] = closeObjects(schema, false);
    }
  }
  const closeResponse = (response: unknown) => {
    if (!isObject(response) || !isObject(response.content)) return;
    for (const media of Object.values(response.content)) {
      if (isObject(media) && 'schema' in media) media.schema = closeObjects(media.schema, true);
    }
  };
  if (isObject(components.responses)) Object.values(components.responses).forEach(closeResponse);
  if (isObject(copy.paths)) {
    for (const item of Object.values(copy.paths)) {
      if (!isObject(item)) continue;
      for (const method of methods) {
        const operation = item[method];
        if (isObject(operation) && isObject(operation.responses)) {
          Object.values(operation.responses).forEach(closeResponse);
        }
      }
    }
  }
  return copy;
}

function newAjv(coerceTypes: boolean): Ajv2020 {
  // OpenAPI 3.1 schemas are JSON Schema 2020-12 plus OpenAPI keywords (`example`, `discriminator`,
  // `x-*`), which strict mode would refuse; they are annotations, so they are ignored.
  const ajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes });
  addFormats(ajv);
  return ajv;
}

/** The documented responses of one surface bundle (`generated/openapi/<surface>.json`). */
export class ContractValidator {
  readonly surface: SurfaceName;
  private readonly bundle: Json;
  private readonly operations = new Map<string, Operation>();
  private readonly bodyAjv = newAjv(false);
  private readonly headerAjv = newAjv(true);
  private readonly compiled = new Map<string, ValidateFunction>();

  constructor(surface: SurfaceName, bundle: Json) {
    this.surface = surface;
    this.bundle = bundle;
    const id = `https://contracts.eeasy-logistics.invalid/${surface}.json`;
    this.bodyAjv.addSchema({ ...closeBundle(bundle), $id: id }, 'bundle');
    this.headerAjv.addSchema({ ...structuredClone(bundle), $id: id }, 'bundle');

    const servers = Array.isArray(bundle.servers) ? bundle.servers : [];
    const first: unknown = servers[0];
    const basePath = isObject(first) && typeof first.url === 'string' ? first.url : '';
    const paths = isObject(bundle.paths) ? bundle.paths : {};
    for (const [path, item] of Object.entries(paths)) {
      if (!isObject(item)) continue;
      for (const method of methods) {
        const operation = item[method];
        if (!isObject(operation) || typeof operation.operationId !== 'string') continue;
        const full = `${basePath.replace(/\/+$/, '')}${path}`;
        const pattern = full
          .split(/(\{[^}]+\})/)
          .map((part) =>
            part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          )
          .join('');
        this.operations.set(operation.operationId, {
          operationId: operation.operationId,
          method: method.toUpperCase(),
          path: full,
          matcher: new RegExp(`^${pattern}/?$`),
          pointer: `/paths/${escapePointer(path)}/${method}`,
        });
      }
    }
  }

  static load(surface: SurfaceName): ContractValidator {
    const file = join(generatedDir, 'openapi', `${surface}.json`);
    return new ContractValidator(surface, JSON.parse(readFileSync(file, 'utf8')) as Json);
  }

  operationIds(): string[] {
    return [...this.operations.keys()].sort();
  }

  has(operationId: string): boolean {
    return this.operations.has(operationId);
  }

  /** The operation a request went to, by method and URL path; `undefined` when none matches. */
  match(method: string, url: string): string | undefined {
    const { pathname } = new URL(url, 'http://placeholder.invalid');
    for (const operation of this.operations.values()) {
      if (operation.method === method.toUpperCase() && operation.matcher.test(pathname)) {
        return operation.operationId;
      }
    }
    return undefined;
  }

  /** Compiles every documented response body and header schema; throws on the first it cannot. */
  compileAll(): number {
    let count = 0;
    for (const operation of this.operations.values()) {
      const responses = this.at(`${operation.pointer}/responses`) ?? {};
      for (const key of Object.keys(responses)) {
        const { pointer, value } = this.resolve(
          `${operation.pointer}/responses/${escapePointer(key)}`,
        );
        for (const [type, media] of Object.entries(isObject(value.content) ? value.content : {})) {
          if (!isObject(media) || !('schema' in media)) continue;
          this.compile(this.bodyAjv, `${pointer}/content/${escapePointer(type)}/schema`);
          count += 1;
        }
        for (const name of Object.keys(isObject(value.headers) ? value.headers : {})) {
          const header = this.resolve(`${pointer}/headers/${escapePointer(name)}`);
          if ('schema' in header.value) this.compile(this.headerAjv, `${header.pointer}/schema`);
        }
      }
    }
    return count;
  }

  /** Every way `response` departs from what `operationId` documents; empty when it conforms. */
  check(operationId: string, response: RecordedResponse): Violation[] {
    const operation = this.operations.get(operationId);
    if (operation === undefined) throw new Error(`${this.surface} has no operation ${operationId}`);
    const responses = this.at(`${operation.pointer}/responses`);
    const status = String(response.status);
    const key = [status, `${status[0] ?? ''}XX`, 'default'].find(
      (candidate) => isObject(responses) && candidate in responses,
    );
    if (key === undefined) {
      return [
        {
          kind: 'undocumented_status',
          at: '',
          message: `${operationId} does not document status ${status} (documents ${Object.keys(responses ?? {}).join(', ')})`,
        },
      ];
    }
    const { pointer, value: documented } = this.resolve(
      `${operation.pointer}/responses/${escapePointer(key)}`,
    );
    const violations: Violation[] = [
      ...this.checkHeaders(pointer, documented, response.headers),
      ...this.checkBody(pointer, documented, response),
    ];
    if (response.status >= 400 && isObject(response.body) && 'code' in response.body) {
      const code = response.body.code;
      if (typeof code !== 'string' || !knownErrorCodes.has(code)) {
        violations.push({
          kind: 'unknown_error_code',
          at: '/code',
          message: `error code ${JSON.stringify(code)} is not in docs/contracts/errors.md`,
        });
      }
    }
    return violations;
  }

  private checkBody(pointer: string, documented: Json, response: RecordedResponse): Violation[] {
    const content = isObject(documented.content) ? documented.content : {};
    if (response.body === undefined) return [];
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (type === undefined || type === '' || !(type in content)) {
      return [
        {
          kind: 'undocumented_content_type',
          at: '',
          message: `content type ${JSON.stringify(type)} with a body is not documented (documents ${Object.keys(content).join(', ') || 'no body'})`,
        },
      ];
    }
    const media = content[type];
    if (!isObject(media) || !('schema' in media)) return [];
    const validate = this.compile(this.bodyAjv, `${pointer}/content/${escapePointer(type)}/schema`);
    if (validate(response.body)) return [];
    return (validate.errors ?? []).map(toViolation);
  }

  private checkHeaders(pointer: string, documented: Json, headers: Headers): Violation[] {
    if (!isObject(documented.headers)) return [];
    const violations: Violation[] = [];
    for (const name of Object.keys(documented.headers)) {
      const { pointer: headerPointer, value: header } = this.resolve(
        `${pointer}/headers/${escapePointer(name)}`,
      );
      const value = headers.get(name);
      if (value === null) {
        if (header.required === true) {
          violations.push({
            kind: 'header_mismatch',
            at: name,
            message: `required header ${name} is missing`,
          });
        }
        continue;
      }
      if (!('schema' in header)) continue;
      const validate = this.compile(this.headerAjv, `${headerPointer}/schema`);
      if (!validate(value)) {
        violations.push({
          kind: 'header_mismatch',
          at: name,
          message: `header ${name} ${(validate.errors ?? []).map((e) => e.message).join('; ')}`,
        });
      }
    }
    return violations;
  }

  private compile(ajv: Ajv2020, pointer: string): ValidateFunction {
    const cacheKey = `${ajv === this.bodyAjv ? 'body' : 'header'}${pointer}`;
    let validate = this.compiled.get(cacheKey);
    if (validate === undefined) {
      validate = ajv.compile({ $ref: `bundle#${pointer}` });
      this.compiled.set(cacheKey, validate);
    }
    return validate;
  }

  /** The object at `pointer`, following `$ref`s to the bundle's components. */
  private resolve(pointer: string): { pointer: string; value: Json } {
    let current = pointer;
    for (let hops = 0; hops < 10; hops += 1) {
      const value = this.at(current);
      if (!isObject(value)) throw new Error(`nothing at ${current} in the ${this.surface} bundle`);
      if (typeof value.$ref !== 'string') return { pointer: current, value };
      current = value.$ref.replace(/^#/, '');
    }
    throw new Error(`$ref chain too deep at ${pointer}`);
  }

  private at(pointer: string): Json | undefined {
    let node: unknown = this.bundle;
    for (const raw of pointer.split('/').slice(1)) {
      const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      node = isObject(node) ? node[token] : undefined;
    }
    return isObject(node) ? node : undefined;
  }
}

function toViolation(error: ErrorObject): Violation {
  if (error.keyword === 'unevaluatedProperties') {
    const field = String((error.params as { unevaluatedProperty?: unknown }).unevaluatedProperty);
    return {
      kind: 'undocumented_field',
      at: `${error.instancePath}/${escapePointer(field)}`,
      message: `field ${JSON.stringify(field)} is not documented`,
    };
  }
  return {
    kind: 'schema_mismatch',
    at: error.instancePath,
    message: `${error.instancePath || 'body'} ${error.message ?? 'does not match'} (${error.schemaPath})`,
  };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  if (/[/+]json\b/i.test(response.headers.get('content-type') ?? '')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * A fetch that keeps a copy of every answer, for the generated client to call through. The client
 * consumes the original; the harness reads the clone.
 */
export function recordingFetch(base: typeof globalThis.fetch = globalThis.fetch): {
  fetch: typeof globalThis.fetch;
  responses: () => Promise<RecordedResponse[]>;
} {
  const pending: Promise<RecordedResponse>[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const response = await base(request);
    const copy = response.clone();
    pending.push(
      readBody(copy).then((body) => ({
        method: request.method,
        url: request.url,
        status: copy.status,
        headers: copy.headers,
        body,
      })),
    );
    return response;
  };
  return { fetch, responses: () => Promise.all(pending) };
}
