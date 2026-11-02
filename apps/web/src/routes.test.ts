import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  featureVisible,
  merchantRoutes,
  navigationFor,
  openModules,
  routeOf,
  routeOpen,
  type MerchantRoute,
} from './routes.ts';

// The route manifest (web §4; WEB-3 plan 2.2): the navigation follows `Me.permissions` and
// `Me.features`, and every route a layout gates is in the manifest.
// node:test returns promises the runner awaits; `void` marks them for no-floating-promises.

const owner = {
  permissions: [
    'core.account.read',
    'core.account.manage',
    'core.members.read',
    'core.members.manage',
    'core.sites.read',
    'core.sites.manage',
    'core.audit.read',
  ],
  features: [],
};
const viewer = {
  permissions: ['core.account.read', 'core.members.read', 'core.sites.read', 'core.audit.read'],
  features: [],
};
const siteStaff = { permissions: ['core.sites.read'], features: [] };

void describe('the merchant route manifest', () => {
  void it('lists each path once, with a navigation entry', () => {
    const paths = merchantRoutes.map((route) => route.path);
    assert.equal(new Set(paths).size, paths.length);
  });

  void it('opens home to every member and settings to holders of its read permission', () => {
    assert.equal(routeOpen(routeOf('/'), siteStaff), true);
    assert.equal(routeOpen(routeOf('/settings/account'), owner), true);
    assert.equal(routeOpen(routeOf('/settings/account'), siteStaff), false);
    assert.equal(routeOpen(routeOf('/settings/account'), {}), false);
  });

  void it('builds the sidebar from the open routes, dropping empty groups', () => {
    const settings = [
      { href: '/settings/account', label: 'settings_account' },
      { href: '/settings/members', label: 'settings_members' },
      { href: '/settings/sites', label: 'settings_sites' },
      { href: '/settings/audit', label: 'settings_audit' },
    ];
    assert.deepEqual(navigationFor(owner), [
      { group: 'main', items: [{ href: '/', label: 'home' }] },
      { group: 'settings', items: settings },
    ]);
    // The viewer reads every settings screen (roles.yaml) and has the same sidebar.
    assert.deepEqual(navigationFor(viewer), navigationFor(owner));
    // Site staff read sites only: the one settings entry they may open.
    assert.deepEqual(navigationFor(siteStaff), [
      { group: 'main', items: [{ href: '/', label: 'home' }] },
      { group: 'settings', items: [{ href: '/settings/sites', label: 'settings_sites' }] },
    ]);
  });

  void it('gates the new-site form on the manage permission, not the read one', () => {
    assert.equal(routeOpen(routeOf('/settings/sites/new'), owner), true);
    assert.equal(routeOpen(routeOf('/settings/sites/new'), viewer), false);
    assert.equal(routeOpen(routeOf('/settings/sites'), viewer), true);
    assert.equal(routeOpen(routeOf('/settings/members'), siteStaff), false);
    assert.equal(routeOpen(routeOf('/settings/audit'), siteStaff), false);
  });

  void it('hides a module whose feature the account does not see, whatever the permissions', () => {
    const orders: MerchantRoute = {
      path: '/orders',
      read: 'delivery.orders.read',
      feature: 'delivery',
    };
    const grants = { permissions: ['delivery.orders.read'], features: [] as string[] };
    assert.equal(featureVisible(orders, grants), false);
    assert.equal(routeOpen(orders, grants), false);
    assert.equal(routeOpen(orders, { ...grants, features: ['delivery'] }), true);
  });

  void it('lists no module on the home page until a module route exists', () => {
    assert.deepEqual(openModules({ ...owner, features: ['delivery'] }), []);
  });

  void it('refuses a path missing from the manifest', () => {
    assert.throws(() => routeOf('/nowhere' as never), /no route \/nowhere/);
  });
});
