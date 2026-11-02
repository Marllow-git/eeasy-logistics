import { ApiException } from '../errors/api-exception.js';

// Optimistic concurrency on dispatcher writes (DEL-2 plan 2.8, 2a; domain model D-22, §8;
// contracts README §5; errors.md `version_required`, `version_conflict`). The `If-Match` header
// carries the aggregate `version` the client read, quoted as an entity tag (`"7"`). The contract
// pipe answers `428 version_required` when an operation declares the header and the request sends
// none; the handler reads the version with `ifMatchVersion` and compares it under its row lock
// with `assertVersion`.

/** The header as the generated operation schemas spell it. */
export const ifMatchHeader = 'If-Match';

const strongTag = /^"([1-9][0-9]{0,8})"$/;
const bareNumber = /^[1-9][0-9]{0,8}$/;

/**
 * The version an `If-Match` value names: a strong entity tag of a positive integer (`"7"`), or the
 * bare integer. A weak tag, a list, `*` or anything else is `400 validation_failed` at
 * `/header/if-match`: a dispatcher write must name the one version it read.
 */
export function ifMatchVersion(raw: string): number {
  const value = raw.trim();
  const digits = strongTag.exec(value)?.[1] ?? (bareNumber.test(value) ? value : undefined);
  if (digits === undefined) {
    throw new ApiException('validation_failed', {
      fields: [{ pointer: '/header/if-match', code: 'invalid' }],
    });
  }
  return Number(digits);
}

/** The `ETag` of an aggregate at `version` (`getOrder`), the value `If-Match` sends back. */
export const entityTag = (version: number): string => `"${version}"`;

/**
 * `409 version_conflict` with the aggregate's `current_status` and `version` unless the client
 * read the version it holds now (D-22; the README §5 example).
 */
export function assertVersion(
  current: { readonly status: string; readonly version: number },
  expected: number,
): void {
  if (current.version !== expected) {
    throw new ApiException('version_conflict', {
      details: { current_status: current.status, version: current.version },
    });
  }
}
