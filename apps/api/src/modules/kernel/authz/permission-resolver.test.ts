import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '../auth/principal.js';
import type { RoleBundle } from './permission-resolver.js';
import { PermissionResolver, bundleKeyOf } from './permission-resolver.js';

// PLAT-10 plan 2.4: the union of the token's bundles, each on its own surface; unknown roles are
// ignored and logged once; a site-scoped bundle grants `sites` unless another bundle grants `all`.

const bundle = (
  key: string,
  surface: RoleBundle['surface'],
  permissions: string[],
  siteScoped = false,
): RoleBundle => ({ key, surface, siteScoped, permissions: new Set(permissions) });

const bundles = [
  bundle('dispatcher', 'staff', ['delivery.orders.read', 'delivery.orders.dispatch']),
  bundle('viewer', 'staff', ['delivery.orders.read', 'core.sites.read']),
  bundle('cashier', 'staff', ['delivery.orders.read', 'delivery.cash.receive'], true),
  bundle('driver', 'driver', ['delivery.driver.work']),
  bundle('platform_support', 'platform', ['platform.accounts.read']),
];

function principal(kind: Principal['kind'], roles: string[]): Principal {
  const facts = {
    userId: '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3e',
    roles,
    scopes: '',
    sites: [],
    tokenVersion: 1,
  };
  const tenant = {
    accountId: '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3f',
    membershipId: '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d40',
  };
  if (kind === 'platform') return { kind, ...facts };
  if (kind === 'driver') return { kind, ...facts, ...tenant, deviceId: tenant.membershipId };
  return { kind, ...facts, ...tenant };
}

describe('PermissionResolver', () => {
  afterEach(() => vi.restoreAllMocks());

  it('unions the bundles a token names', () => {
    const grants = new PermissionResolver(bundles).grantsOf(
      principal('staff', ['viewer', 'dispatcher']),
    );
    expect([...grants.keys()].sort()).toEqual([
      'core.sites.read',
      'delivery.orders.dispatch',
      'delivery.orders.read',
    ]);
  });

  it('ignores an unknown role and logs it once', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const resolver = new PermissionResolver(bundles);
    expect(resolver.grantsOf(principal('staff', ['ghost'])).size).toBe(0);
    expect(resolver.grantsOf(principal('staff', ['ghost', 'viewer'])).has('core.sites.read')).toBe(
      true,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('"ghost"');
  });

  it('counts a bundle only on its own surface', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const resolver = new PermissionResolver(bundles);
    expect(resolver.grantsOf(principal('driver', ['dispatcher'])).size).toBe(0);
    expect(resolver.grantsOf(principal('staff', ['driver'])).size).toBe(0);
    expect(resolver.grantsOf(principal('driver', ['driver'])).get('delivery.driver.work')).toBe(
      'all',
    );
  });

  it('reads a platform token role as its platform bundle', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const resolver = new PermissionResolver(bundles);
    expect(bundleKeyOf('platform', 'support')).toBe('platform_support');
    expect(
      resolver.grantsOf(principal('platform', ['support'])).has('platform.accounts.read'),
    ).toBe(true);
    expect(resolver.grantsOf(principal('platform', ['platform_support'])).size).toBe(0);
    expect(resolver.grantsOf(principal('platform', ['viewer'])).size).toBe(0);
  });

  it('grants through a site-scoped bundle as `sites`, unless another bundle grants `all`', () => {
    const resolver = new PermissionResolver(bundles);
    const cashier = resolver.grantsOf(principal('staff', ['cashier']));
    expect(cashier.get('delivery.cash.receive')).toBe('sites');
    expect(cashier.get('delivery.orders.read')).toBe('sites');
    for (const roles of [
      ['cashier', 'viewer'],
      ['viewer', 'cashier'],
    ]) {
      const both = resolver.grantsOf(principal('staff', roles));
      expect(both.get('delivery.orders.read'), roles.join()).toBe('all');
      expect(both.get('delivery.cash.receive'), roles.join()).toBe('sites');
    }
  });

  it('computes once per principal', () => {
    const resolver = new PermissionResolver(bundles);
    const who = principal('staff', ['viewer']);
    expect(resolver.grantsOf(who)).toBe(resolver.grantsOf(who));
  });

  it('refuses everything with no bundles at all', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(new PermissionResolver([]).grantsOf(principal('staff', ['owner'])).size).toBe(0);
  });
});
