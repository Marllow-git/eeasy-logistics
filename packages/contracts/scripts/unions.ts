// Writes generated/unions.ts (PLAT-15 plan 2.5): `Permission` from docs/contracts/permissions.yaml,
// `StreamEventName` from the `x-sse-events` of the stream operations in the bundles (a wildcard
// family such as `delivery.order.*` expanded from the domain event catalogue, domain-model §6.3),
// `ErrorCode`
// from the first column of every table in docs/contracts/errors.md, and the states of the order,
// offer, attempt and custody state machines (document 2 §3.13 to §3.16) from their component
// schemas (WEB-1 review: both web apps may import `/unions`, not every surface). Each union has a
// runtime list beside it. A misspelt permission, event or code then fails typecheck.
// Run after scripts/bundle.ts: pnpm --filter contracts build
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { contractsDir, generatedDir, surfaces } from './paths.ts';

/** Permission strings in catalogue order. */
export function readPermissions(file = join(contractsDir, 'permissions.yaml')): string[] {
  const doc = parse(readFileSync(file, 'utf8')) as { permissions: Record<string, string[]> };
  return Object.values(doc.permissions).flat();
}

/** Error codes: the backticked first cell of every table row in errors.md, in document order. */
export function readErrorCodes(file = join(contractsDir, 'errors.md')): string[] {
  const codes: string[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\|\s*`([a-z][a-z0-9_]*)`\s*\|/.exec(line);
    if (match?.[1] !== undefined) codes.push(match[1]);
  }
  return codes;
}

/**
 * Event names of the domain event catalogue (docs/architecture/domain-model.md §6.3): the backticked
 * first cell of each table row; a shorthand sibling (`delivery.shift.started` / `.ended`) is
 * expanded against the name before it.
 */
export function readDomainEvents(
  file = join(contractsDir, '../architecture/domain-model.md'),
): string[] {
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('\n### 6.3 Catalogue');
  if (start < 0) throw new Error('domain-model.md has no "### 6.3 Catalogue" section');
  const end = text.indexOf('\n#', start + 1);
  const events: string[] = [];
  for (const line of text.slice(start, end < 0 ? undefined : end).split('\n')) {
    const cell = /^\|([^|]*)\|/.exec(line)?.[1] ?? '';
    const names = [...cell.matchAll(/`([a-z_.]+)`/g)].map((m) => m[1] ?? '');
    const first = names[0];
    if (first === undefined || !/^[a-z_]+(?:\.[a-z_]+)+$/.test(first)) continue;
    events.push(first);
    const stem = first.slice(0, first.lastIndexOf('.'));
    for (const sibling of names.slice(1)) {
      if (sibling.startsWith('.')) events.push(`${stem}${sibling}`);
    }
  }
  return events;
}

type Schema = { enum?: unknown[]; properties?: Record<string, Schema> };

/**
 * The state lists of document 2 §3.13 to §3.16, read from docs/contracts/openapi/components.yaml:
 * `OrderStatus`, `Offer.status`, `Attempt.status`, `CodCollection.custody`.
 */
export function readStateMachines(
  file = join(contractsDir, 'openapi/components.yaml'),
): Record<'order' | 'offer' | 'attempt' | 'custody', string[]> {
  const doc = parse(readFileSync(file, 'utf8')) as {
    components: { schemas: Record<string, Schema> };
  };
  const schemas = doc.components.schemas;
  const states = (where: string, schema: Schema | undefined): string[] => {
    const values = schema?.enum;
    if (!values?.every((v): v is string => typeof v === 'string')) {
      throw new Error(`state machine: ${where} has no string enum in components.yaml`);
    }
    return values;
  };
  return {
    order: states('OrderStatus', schemas.OrderStatus),
    offer: states('Offer.status', schemas.Offer?.properties?.status),
    attempt: states('Attempt.status', schemas.Attempt?.properties?.status),
    custody: states('CodCollection.custody', schemas.CodCollection?.properties?.custody),
  };
}

/** Replaces each family (`a.b.*`) by the catalogue events under `a.b.`; fails on an empty family. */
export function expandFamilies(names: string[], catalogue: string[]): string[] {
  const result = new Set<string>();
  for (const name of names) {
    if (!name.endsWith('.*')) {
      result.add(name);
      continue;
    }
    const prefix = name.slice(0, -1);
    const members = catalogue.filter((event) => event.startsWith(prefix));
    if (members.length === 0)
      throw new Error(`StreamEventName: ${name} matches no catalogue event`);
    members.forEach((member) => result.add(member));
  }
  return [...result];
}

const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/** SSE event names from `x-sse-events` across the surface bundles, first occurrence order. */
export function readStreamEventNames(dir = join(generatedDir, 'openapi')): string[] {
  const names = new Set<string>();
  for (const surface of surfaces) {
    const doc = JSON.parse(readFileSync(join(dir, `${surface.name}.json`), 'utf8')) as {
      paths?: Record<string, Record<string, { 'x-sse-events'?: string[] }>>;
    };
    for (const pathItem of Object.values(doc.paths ?? {})) {
      for (const method of methods) {
        for (const name of pathItem[method]?.['x-sse-events'] ?? []) names.add(name);
      }
    }
  }
  return [...names];
}

function unique(kind: string, values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${kind}: duplicate ${value}`);
    seen.add(value);
  }
  if (values.length === 0) throw new Error(`${kind}: none found`);
  return values;
}

function list(values: string[]): string {
  return values.map((v) => `  '${v}',`).join('\n');
}

export function renderUnions(): string {
  const permissions = unique('Permission', readPermissions());
  const errorCodes = unique('ErrorCode', readErrorCodes());
  const events = unique(
    'StreamEventName',
    expandFamilies(readStreamEventNames(), readDomainEvents()),
  );
  const machines = readStateMachines();
  const order = unique('OrderState', machines.order);
  const offer = unique('OfferState', machines.offer);
  const attempt = unique('AttemptState', machines.attempt);
  const custody = unique('CustodyState', machines.custody);
  return `// Generated by scripts/unions.ts from docs/contracts. Do not edit (document 3 §9).

/** \`x-permission\` values: the catalogue of document 3 §11 (docs/contracts/permissions.yaml). */
export const permissions = [
${list(permissions)}
] as const;
export type Permission = (typeof permissions)[number];

/** Stable error codes of docs/contracts/errors.md (document 3 §4). */
export const errorCodes = [
${list(errorCodes)}
] as const;
export type ErrorCode = (typeof errorCodes)[number];

/**
 * SSE \`event:\` names from the \`x-sse-events\` of the stream operations (document 3 §6, ADR-0029),
 * each wildcard family expanded from the domain event catalogue (domain-model §6.3).
 */
export const streamEventNames = [
${list(events)}
] as const;
export type StreamEventName = (typeof streamEventNames)[number];

const streamEventNameSet: ReadonlySet<string> = new Set(streamEventNames);

/** True when \`name\` is an SSE event a stream of this API can send. */
export function isStreamEventName(name: string): name is StreamEventName {
  return streamEventNameSet.has(name);
}

/** Order states, document 2 §3.13 (\`OrderStatus\` in components.yaml). */
export const orderStates = [
${list(order)}
] as const;
export type OrderState = (typeof orderStates)[number];

/** Offer states, document 2 §3.14 (\`Offer.status\`). */
export const offerStates = [
${list(offer)}
] as const;
export type OfferState = (typeof offerStates)[number];

/** Attempt states, document 2 §3.15 (\`Attempt.status\`). */
export const attemptStates = [
${list(attempt)}
] as const;
export type AttemptState = (typeof attemptStates)[number];

/** COD custody states, document 2 §3.16 (\`CodCollection.custody\`). */
export const custodyStates = [
${list(custody)}
] as const;
export type CustodyState = (typeof custodyStates)[number];
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(generatedDir, 'unions.ts'), renderUnions());
}
