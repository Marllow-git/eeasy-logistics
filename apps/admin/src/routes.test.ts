import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { consoleRoutes, homeAreas, navigationFor, routeOf, routeOpen } from './routes.ts';

// The console's route manifest (web §4; WEB-4 plan 2.1): the navigation follows
// `PlatformMe.permissions` as roles.yaml grants them, and every route a layout gates is in it.
// node:test returns promises the runner awaits; `void` marks them for no-floating-promises.

const superAdmin = {
  permissions: [
    'platform.accounts.read',
    'platform.accounts.provision',
    'platform.accounts.suspend',
    'platform.rollout.manage',
    'platform.flags.manage',
    'platform.tenants.read',
    'platform.outbox.read',
    'platform.outbox.replay',
    'platform.staff.manage',
    'platform.audit.read',
  ],
};
const support = {
  permissions: [
    'platform.accounts.read',
    'platform.tenants.read',
    'platform.outbox.read',
    'platform.audit.read',
  ],
};

void describe('consoleRoutes', () => {
  void it('opens the provisioning form to the provision permission only', () => {
    const form = routeOf('/accounts/new');
    assert.equal(routeOpen(form, superAdmin), true);
    assert.equal(routeOpen(form, support), false);
    assert.equal(routeOpen(form, { permissions: undefined }), false);
  });

  void it('opens the home to every signed-in staff member', () => {
    assert.equal(routeOpen(routeOf('/'), { permissions: [] }), true);
  });

  void it('lists every path once', () => {
    const paths = consoleRoutes.map((route) => route.path);
    assert.equal(new Set(paths).size, paths.length);
  });

  void it('throws for a path outside the manifest', () => {
    assert.throws(() => routeOf('/nowhere' as never), /no route \/nowhere/);
  });
});

void describe('navigationFor', () => {
  void it('groups the open routes in order, the accounts list current on its pages', () => {
    assert.deepEqual(navigationFor(superAdmin), [
      { group: 'main', items: [{ href: '/', label: 'home', prefix: false }] },
      {
        group: 'accounts',
        items: [
          { href: '/accounts', label: 'accounts', prefix: true },
          { href: '/rollout', label: 'rollout', prefix: false },
        ],
      },
    ]);
  });

  void it('drops the groups a session opens nothing in', () => {
    assert.deepEqual(navigationFor({ permissions: [] }), [
      { group: 'main', items: [{ href: '/', label: 'home', prefix: false }] },
    ]);
  });

  void it('gives the home its areas without itself', () => {
    assert.deepEqual(
      homeAreas(support).map((entry) => entry.href),
      ['/accounts', '/rollout'],
    );
    assert.deepEqual(homeAreas({ permissions: [] }), []);
  });
});
