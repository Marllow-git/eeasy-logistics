import type { RequestContext } from '@eeasy-logistics/db';
import { PgDialect, pgTable, uuid } from 'drizzle-orm/pg-core';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../errors/api-exception.js';
import { runWithContext } from '@eeasy-logistics/db/testing';
import { assertSiteInScope, normaliseSiteIds, siteFilter } from './site-scope.js';

// PLAT-10 plan 2.6: the declared site against the token's sites (404 outside, 404 with none), and
// the repository predicate.

const siteA = '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3e';
const siteB = '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3f';
const rows = pgTable('rows', { siteId: uuid('site_id') });
const dialect = new PgDialect();

function context(siteIds?: readonly string[]): RequestContext {
  return Object.freeze({
    ...(siteIds === undefined ? {} : { siteIds }),
    accountId: siteA,
    membershipId: null,
    userId: null,
    deviceId: null,
    actingCrossTenant: false,
  });
}

function requestWith(part: Partial<Pick<Request, 'params' | 'query' | 'body'>>): Request {
  return { params: {}, query: {}, body: undefined, ...part } as Request;
}

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof ApiException ? error.code : 'error';
  }
}

describe('assertSiteInScope', () => {
  const path = { from: 'path', name: 'site_id' } as const;

  it('passes a site of the token and refuses another with 404', () => {
    expect(
      codeOf(() => assertSiteInScope(requestWith({ params: { site_id: siteA } }), path, [siteA])),
    ).toBeUndefined();
    expect(
      codeOf(() => assertSiteInScope(requestWith({ params: { site_id: siteB } }), path, [siteA])),
    ).toBe('not_found');
  });

  it('refuses everything with no sites, even without a declared site', () => {
    expect(codeOf(() => assertSiteInScope(requestWith({}), undefined, []))).toBe('not_found');
    expect(codeOf(() => assertSiteInScope(requestWith({}), undefined, [siteA]))).toBeUndefined();
  });

  it('lets a query site be absent, never a body one', () => {
    const query = { from: 'query', name: 'site_id' } as const;
    const body = { from: 'body', name: 'site_id' } as const;
    expect(codeOf(() => assertSiteInScope(requestWith({}), query, [siteA]))).toBeUndefined();
    expect(
      codeOf(() =>
        assertSiteInScope(requestWith({ query: { site_id: [siteA, siteA] } }), query, [siteA]),
      ),
    ).toBe('not_found');
    expect(codeOf(() => assertSiteInScope(requestWith({ body: {} }), body, [siteA]))).toBe(
      'not_found',
    );
    expect(
      codeOf(() => assertSiteInScope(requestWith({ body: { site_id: siteA } }), body, [siteA])),
    ).toBeUndefined();
  });

  it('treats a path decorator without its route parameter as a programming error', () => {
    expect(codeOf(() => assertSiteInScope(requestWith({}), path, [siteA]))).toBe('error');
  });
});

describe('siteFilter', () => {
  it('adds no predicate for a context that is not site-scoped', () => {
    expect(siteFilter(context(), rows.siteId)).toBeUndefined();
  });

  it('limits to the context siteIds, and to nothing for an empty list', () => {
    const filter = siteFilter(context([siteA, siteB]), rows.siteId);
    expect(filter && dialect.sqlToQuery(filter)).toMatchObject({
      sql: '"rows"."site_id" in ($1, $2)',
      params: [siteA, siteB],
    });
    const none = siteFilter(context([]), rows.siteId);
    expect(none && dialect.sqlToQuery(none).sql).toBe('false');
  });

  it('keeps filtering on a copied context (adversary A-2)', () => {
    const copy = { ...context([siteA]) };
    const filter = siteFilter(copy, rows.siteId);
    expect(filter && dialect.sqlToQuery(filter).params).toEqual([siteA]);
  });

  it('throws for a context without siteIds inside a site-scoped request', () => {
    const scoped = context([siteA]);
    const stripped: RequestContext = { ...scoped, siteIds: undefined };
    runWithContext(scoped, () => {
      expect(() => siteFilter(stripped, rows.siteId)).toThrow('site-scoped request');
      expect(siteFilter(scoped, rows.siteId)).toBeDefined();
    });
    runWithContext(context(), () => {
      expect(siteFilter(stripped, rows.siteId)).toBeUndefined();
    });
  });
});

describe('normaliseSiteIds (lead review round 1)', () => {
  const mixed = [siteA.toUpperCase(), siteB, siteA, 'not-a-site'];

  it('lowercases, keeps UUIDs only and drops repeats', () => {
    const sites = normaliseSiteIds(mixed);
    expect(sites).toEqual([siteA, siteB]);
    expect(Object.isFrozen(sites)).toBe(true);
  });

  it('gives the scope check and the list filter the same list for a mixed-case claim', () => {
    const sites = normaliseSiteIds([siteA.toUpperCase()]);
    const path = { from: 'path', name: 'site_id' } as const;
    for (const named of [siteA, siteA.toUpperCase()]) {
      expect(
        codeOf(() => assertSiteInScope(requestWith({ params: { site_id: named } }), path, sites)),
      ).toBeUndefined();
    }
    const filter = siteFilter(context(sites), rows.siteId);
    expect(filter && dialect.sqlToQuery(filter).params).toEqual([siteA]);
  });

  it('leaves nothing for a claim of no UUID: the request sees nothing', () => {
    const sites = normaliseSiteIds(['not-a-site']);
    expect(sites).toEqual([]);
    expect(codeOf(() => assertSiteInScope(requestWith({}), undefined, sites))).toBe('not_found');
  });
});
