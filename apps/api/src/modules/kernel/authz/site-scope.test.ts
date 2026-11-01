import type { RequestContext } from '@eeasy-logistics/db';
import { PgDialect, pgTable, uuid } from 'drizzle-orm/pg-core';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../errors/api-exception.js';
import { assertSiteInScope, bindContextSiteScope, siteFilter, siteIdsOf } from './site-scope.js';

// PLAT-10 plan 2.6: the declared site against the token's sites (404 outside, 404 with none), and
// the repository predicate.

const siteA = '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3e';
const siteB = '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3f';
const rows = pgTable('rows', { siteId: uuid('site_id') });
const dialect = new PgDialect();

function context(): RequestContext {
  return Object.freeze({
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

  it('limits to the bound sites, and to nothing for an empty list', () => {
    const scoped = context();
    bindContextSiteScope(scoped, [siteA, siteB]);
    expect(siteIdsOf(scoped)).toEqual([siteA, siteB]);
    const filter = siteFilter(scoped, rows.siteId);
    expect(filter && dialect.sqlToQuery(filter)).toMatchObject({
      sql: '"rows"."site_id" in ($1, $2)',
      params: [siteA, siteB],
    });
    const empty = context();
    bindContextSiteScope(empty, []);
    const none = siteFilter(empty, rows.siteId);
    expect(none && dialect.sqlToQuery(none).sql).toBe('false');
  });

  it('binds only to a frozen context', () => {
    expect(() => bindContextSiteScope({ ...context() }, [siteA])).toThrow('frozen');
  });
});
