import type { RequestContext } from '@eeasy-logistics/db';
import { findContext, isUuid } from '@eeasy-logistics/db';
import { SetMetadata } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { inArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Request } from 'express';
import { ApiException } from '../errors/api-exception.js';

// Site scoping (PLAT-10 plan 2.6; identity and tenancy §2; contracts README §4). Site restriction is
// data on the membership: a principal that holds an operation's permission only through
// site-scoped bundles (site staff, warehouse staff, cashier) acts on the sites of its token's
// `sites` claim alone. Another site's resource is `404 not_found`, never `403` (README §4), and an
// empty site list sees nothing. A permission also held through a bundle that is not site-scoped is
// not restricted; non-site-scoped roles ignore `sites`.

/** Where a `@SiteScoped()` handler's request names its site. */
export interface SiteScopedSource {
  readonly from: 'path' | 'query' | 'body';
  readonly name: string;
}

export const SITE_SCOPED = Symbol('elx:site-scoped');

/**
 * Marks a handler whose request names one site (`site_id` in the path by default). A site-scoped
 * principal whose `sites` do not include it gets `404 not_found` before the handler runs. A query
 * parameter may be absent (a list over every site of the principal: the handler filters with
 * `siteFilter`); a path or body site must be present, or the request is `404` too.
 */
export const SiteScoped = (
  source: SiteScopedSource = { from: 'path', name: 'site_id' },
): MethodDecorator => SetMetadata(SITE_SCOPED, Object.freeze({ ...source }));

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The token's `sites` claim as the one list both `assertSiteInScope` and `siteFilter` use (lead
 * review round 1): lowercased, then UUIDs only (a value that is not one is dropped, never widened;
 * the claim schema already refuses a token carrying one), without duplicates, frozen.
 */
export function normaliseSiteIds(sites: readonly string[]): readonly string[] {
  return Object.freeze([
    ...new Set(sites.map((site) => site.toLowerCase()).filter((site) => isUuid(site))),
  ]);
}

/**
 * Checks the site a request names against a site-scoped principal's normalised `sites`
 * (`normaliseSiteIds`; plan 2.6 a, c); throws `404 not_found` when it is outside them, absent where
 * it must be present, or when the principal has no site at all.
 */
export function assertSiteInScope(
  request: Request,
  source: SiteScopedSource | undefined,
  sites: readonly string[],
): void {
  if (sites.length === 0) throw new ApiException('not_found');
  if (source === undefined) return;
  let raw: unknown;
  if (source.from === 'path') {
    raw = request.params[source.name];
    if (typeof raw !== 'string') {
      // A programming error: the decorator is on a route without the parameter.
      throw new Error(`@SiteScoped() needs a route parameter :${source.name}`);
    }
  } else {
    const bag = objectOf(source.from === 'query' ? request.query : request.body);
    raw = bag !== undefined && Object.hasOwn(bag, source.name) ? bag[source.name] : undefined;
    if (raw === undefined && source.from === 'query') return;
  }
  const site = typeof raw === 'string' ? raw.toLowerCase() : undefined;
  if (site === undefined || !sites.includes(site)) {
    throw new ApiException('not_found');
  }
}

/** The sites of the request's site-scoped principal, set by the permission guard. */
const requestScopes = new WeakMap<Request, readonly string[]>();

/** Records the request's normalised sites (`normaliseSiteIds`) for its tenant context. */
export function setRequestSiteScope(request: Request, sites: readonly string[]): void {
  requestScopes.set(request, sites);
}

/** The sites the unit-of-work interceptor puts on the request's context as `siteIds`. */
export function requestSiteScope(request: Request): readonly string[] | undefined {
  return requestScopes.get(request);
}

/**
 * The predicate a repository adds to a list or lookup of site-owned rows (plan 2.6 b):
 * `column IN (sites)` when the context carries `siteIds` (a site-scoped principal; nothing at all
 * when the list is empty), no predicate otherwise. Pass `getContext()` and the table's `site_id`
 * column: `.where(and(eq(t.status, s), siteFilter(getContext(), t.siteId)))`. The sites are a field
 * of the context (packages/db), so any copy of it keeps them (adversary A-2); a context without
 * `siteIds` inside a site-scoped request is a programming error and throws rather than reading
 * every site.
 */
export function siteFilter(ctx: RequestContext, column: AnyPgColumn): SQL | undefined {
  const sites = ctx.siteIds;
  if (sites === undefined) {
    if (findContext()?.siteIds !== undefined) {
      throw new Error('siteFilter in a site-scoped request needs its context (getContext())');
    }
    return undefined;
  }
  if (sites.length === 0) return sql`false`;
  return inArray(column, [...sites]);
}
