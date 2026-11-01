// The three unions (PLAT-15 plan 2.5) against the documents they come from.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ErrorCode, Permission, StreamEventName } from '../generated/unions.ts';
import { errorCodes, permissions, streamEventNames } from '../generated/unions.ts';
import type { ApiErrorCode } from '../src/http.ts';

const contractsDir = resolve(import.meta.dirname, '../../../docs/contracts');
const readme = readFileSync(join(contractsDir, 'README.md'), 'utf8');

/** The body of a README section, from its `## <n>.` heading to the next `## `. */
function section(number: number): string {
  const start = readme.indexOf(`\n## ${number}. `);
  const end = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, end);
}

/** Backticked dotted names (`a.b.c`, `a.b.*`) in the given table rows. */
function dottedNames(rows: string[]): string[] {
  return rows.flatMap((row) =>
    [...row.matchAll(/`([a-z_]+(?:\.[a-z_*]+)+)`/g)].map((m) => m[1] ?? ''),
  );
}

/** Committed snapshot: errors.md holds 70 codes (2026-11-01). A new code changes this number. */
const errorCodeCount = 70;

describe('Permission', () => {
  it('equals the README §11 catalogue table, in count and members', () => {
    const body = section(11);
    // The first table (module rows); the role-bundle table below repeats names with shorthand.
    const table = body.slice(0, body.indexOf('Role bundles'));
    const rows = table
      .split('\n')
      .filter((line) => /^\| [a-z]/.test(line) && !line.startsWith('| Module'));
    const fromReadme = dottedNames(rows);
    expect(permissions).toHaveLength(fromReadme.length);
    expect(new Set(permissions)).toEqual(new Set(fromReadme));
    expect(permissions).toHaveLength(76);
  });
});

describe('ErrorCode', () => {
  it('has as many codes as the errors.md tables (snapshot)', () => {
    const rows = readFileSync(join(contractsDir, 'errors.md'), 'utf8')
      .split('\n')
      .filter((line) => /^\| `[a-z_]+` \|/.test(line));
    expect(rows).toHaveLength(errorCodeCount);
    expect(errorCodes).toHaveLength(errorCodeCount);
    expect(new Set(errorCodes).size).toBe(errorCodeCount);
  });
});

describe('StreamEventName', () => {
  it('lists the README §6 stream table names plus stream.resync', () => {
    const body = section(6);
    const table = body.slice(0, body.indexOf('Rules (ADR-0029)'));
    const rows = table.split('\n').filter((line) => line.startsWith('| ') && line.includes('/v1/'));
    // The "Event names" column is the last one; "Who" names permissions.
    const eventCells = rows.map((row) => row.split('|').at(-2) ?? '');
    const fromReadme = new Set([...dottedNames(eventCells), 'stream.resync']);
    expect(new Set(streamEventNames)).toEqual(fromReadme);
  });
});

describe('typecheck guards (checked by tsc, asserted at runtime for completeness)', () => {
  it('rejects misspelt values', () => {
    // @ts-expect-error a permission outside the catalogue is not a Permission
    const permission: Permission = 'core.sitez.read';
    // @ts-expect-error a code outside errors.md is not an ErrorCode
    const code: ErrorCode = 'version_conflit';
    // @ts-expect-error an event outside README §6 is not a StreamEventName
    const event: StreamEventName = 'delivery.shift.startd';
    // A wildcard family accepts any event of that family.
    const family: StreamEventName = 'delivery.order.picked_up';
    const apiCode: ApiErrorCode = 'unexpected_response';
    expect([permission, code, event, family, apiCode]).toHaveLength(5);
  });
});
