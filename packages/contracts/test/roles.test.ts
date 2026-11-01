// The role bundles (PLAT-10 plan 2.1, 2.2): docs/contracts/roles.yaml equals README §11 "Role
// bundles", the generated roles.ts and permission maps equal their sources, and generating twice
// gives the same text.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { roleBundles, roleKeys } from '../generated/roles.ts';
import { bundleOperations, mapOperationSchemas, renderOperations } from '../scripts/operations.ts';
import { surfaces } from '../scripts/paths.ts';
import { readRoles, renderRoles } from '../scripts/unions.ts';
import * as staffEntry from '../src/schemas/staff.ts';
import * as platformEntry from '../src/schemas/platform.ts';
import * as driverEntry from '../src/schemas/driver.ts';
import * as recipientEntry from '../src/schemas/recipient.ts';
import * as publicEntry from '../src/schemas/public.ts';

const packageRoot = resolve(import.meta.dirname, '..');
const contractsDir = resolve(packageRoot, '../../docs/contracts');
const readme = readFileSync(join(contractsDir, 'README.md'), 'utf8');
const catalogue = (
  parse(readFileSync(join(contractsDir, 'permissions.yaml'), 'utf8')) as {
    permissions: Record<string, string[]>;
  }
).permissions;
/** The brand of a generated operation entry (scripts/operations.ts; apps/api checks it at boot). */
const contractOperationBrand = Symbol.for('elx.contract-operation');
const doors = new Set(['core.auth.anonymous', 'core.auth.self', 'platform.auth.self']);

/** README §11 rows of the "Role bundles" table: role name and the "Holds" cell. */
function readmeBundles(): [string, string][] {
  const start = readme.indexOf('\n## 11. ');
  const body = readme.slice(start, readme.indexOf('\n## ', start + 1));
  const table = body.slice(body.indexOf('Role bundles'));
  return table
    .split('\n')
    .filter((line) => /^\| [a-z]/.test(line) && !line.startsWith('| Role'))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      return [cells[1] ?? '', cells[2] ?? ''];
    });
}

/** Backticked permission names in `text`; a shorthand `.create` takes the stem of the name before. */
function names(text: string): string[] {
  const found: string[] = [];
  let stem = '';
  for (const match of text.matchAll(/`(\.?[a-z_]+(?:\.[a-z_]+)*)`/g)) {
    const name = match[1] ?? '';
    if (name.startsWith('.') && stem !== '') {
      found.push(`${stem}${name}`);
    } else if (/^[a-z_]+\.[a-z_]+\.[a-z_]+$/.test(name)) {
      found.push(name);
      stem = name.slice(0, name.lastIndexOf('.'));
    }
  }
  return found;
}

const accountModules = [
  ...(catalogue.core ?? []),
  ...(catalogue.delivery_staff ?? []),
  ...(catalogue.wms ?? []),
];

/**
 * The permissions README §11 gives a role, phrase by phrase (clauses split on `;`): "every core,
 * delivery and wms permission above" is the core, delivery (staff) and wms rows; "the owner set";
 * "every `*.read` permission of core, delivery and wms"; "every platform permission [except …]";
 * otherwise the backticked names. A clause starting "never" lists names the role must not hold.
 * Doors are not role permissions (roles.yaml header), so they are dropped.
 */
function expectedFromReadme(): Map<string, { holds: Set<string>; never: string[] }> {
  const result = new Map<string, { holds: Set<string>; never: string[] }>();
  for (const [role, cell] of readmeBundles()) {
    const holds = new Set<string>();
    const never: string[] = [];
    for (const clause of cell.split(';').map((c) => c.trim())) {
      if (clause.startsWith('never')) {
        never.push(...names(clause));
        continue;
      }
      if (clause.startsWith('every core, delivery and wms permission')) {
        accountModules.forEach((p) => holds.add(p));
      } else if (clause.startsWith('the owner set')) {
        result.get('owner')?.holds.forEach((p) => holds.add(p));
        continue;
      } else if (clause.startsWith('every `*.read` permission of core, delivery and wms')) {
        accountModules.filter((p) => p.endsWith('.read')).forEach((p) => holds.add(p));
        continue;
      } else if (clause.startsWith('every platform permission except')) {
        const except = new Set(names(clause));
        (catalogue.platform ?? []).filter((p) => !except.has(p)).forEach((p) => holds.add(p));
        continue;
      } else if (clause.startsWith('every platform permission')) {
        (catalogue.platform ?? []).forEach((p) => holds.add(p));
        continue;
      }
      names(clause).forEach((p) => holds.add(p));
    }
    doors.forEach((door) => holds.delete(door));
    result.set(role.replaceAll(' ', '_'), { holds, never });
  }
  return result;
}

describe('roles.yaml', () => {
  const roles = readRoles();
  const expected = expectedFromReadme();

  it('has the eleven roles of README §11 in table order', () => {
    expect(roles.map((role) => role.key)).toEqual([...expected.keys()]);
    expect(roles).toHaveLength(11);
  });

  it('gives each role exactly the permissions README §11 names, and none it forbids', () => {
    for (const role of roles) {
      const readmeRole = expected.get(role.key);
      expect(new Set(role.permissions), role.key).toEqual(readmeRole?.holds);
      for (const forbidden of readmeRole?.never ?? []) {
        expect(role.permissions, `${role.key} never ${forbidden}`).not.toContain(forbidden);
      }
    }
    // Spot checks of the phrase reading, so a parser slip cannot pass silently.
    expect(expected.get('owner')?.holds.size).toBe(55);
    expect(expected.get('dispatcher')?.holds).toContain('delivery.orders.cancel');
    expect(expected.get('viewer')?.holds.size).toBe(18);
    expect(expected.get('platform_admin')?.holds).not.toContain('platform.rollout.manage');
    expect(expected.get('cashier')?.never).toEqual([
      'delivery.orders.dispatch',
      'delivery.liability.record',
    ]);
  });

  it('marks site staff, warehouse staff and cashier site-scoped, and each role with its surface', () => {
    expect(roles.filter((role) => role.siteScoped).map((role) => role.key)).toEqual([
      'site_staff',
      'warehouse_staff',
      'cashier',
    ]);
    for (const role of roles) {
      const surface = role.key.startsWith('platform_')
        ? 'platform'
        : role.key === 'driver'
          ? 'driver'
          : 'staff';
      expect(role.surface, role.key).toBe(surface);
      expect(role.scope, role.key).toBe(surface === 'platform' ? 'platform' : 'account');
    }
  });

  it('keeps the driver bundle free of cash permissions and the staff bundles free of driver ones (M9)', () => {
    const driver = roles.find((role) => role.key === 'driver');
    expect(driver?.permissions.some((p) => p.startsWith('delivery.cash.'))).toBe(false);
    for (const role of roles.filter((r) => r.key !== 'driver')) {
      expect(
        role.permissions.some((p) => p.startsWith('delivery.driver.')),
        role.key,
      ).toBe(false);
    }
  });
});

describe('generated roles.ts (plan 2.2)', () => {
  it('equals roles.yaml', () => {
    expect([...roleKeys]).toEqual(readRoles().map((role) => role.key));
    for (const role of readRoles()) {
      const bundle = roleBundles[role.key as keyof typeof roleBundles];
      expect(bundle, role.key).toEqual({
        scope: role.scope,
        surface: role.surface,
        siteScoped: role.siteScoped,
        permissions: role.permissions,
      });
    }
  });

  it('is what the generator writes, and two generations are identical', () => {
    const onDisk = readFileSync(join(packageRoot, 'generated/roles.ts'), 'utf8');
    expect(renderRoles()).toBe(onDisk);
    expect(renderRoles()).toBe(renderRoles());
  });
});

describe('generated operation permission maps (plan 2.2)', () => {
  const entries = {
    staff: staffEntry,
    platform: platformEntry,
    driver: driverEntry,
    recipient: recipientEntry,
    public: publicEntry,
  };

  it('give every operation its x-permission and list the x-cross-tenant ones, per surface', () => {
    for (const { name } of surfaces) {
      const access = bundleOperations(name);
      const entry = entries[name];
      expect(entry.operationPermissions, name).toEqual(
        Object.fromEntries(access.map((operation) => [operation.id, operation.permission])),
      );
      expect([...entry.crossTenantOperations], name).toEqual(
        access.filter((operation) => operation.crossTenant).map((operation) => operation.id),
      );
      const schemas: Record<string, { operationId: string; surface: string; permission: string }> =
        entry.operationSchemas;
      for (const operation of access) {
        const bound = schemas[operation.id];
        expect(bound?.operationId).toBe(operation.id);
        expect(bound?.surface).toBe(name);
        expect(bound?.permission).toBe(operation.permission);
        expect(Object.isFrozen(bound)).toBe(true);
        // Adversary A-4: a non-enumerable brand holding the id, which a spread copy loses.
        const brand = Object.getOwnPropertyDescriptor(bound, contractOperationBrand);
        expect(brand?.value).toBe(operation.id);
        expect(brand?.enumerable).toBe(false);
        expect(Object.getOwnPropertyDescriptor({ ...bound }, contractOperationBrand)).toBe(
          undefined,
        );
      }
    }
    expect(platformEntry.crossTenantOperations).toContain('platformListAccountAudit');
    expect(staffEntry.operationPermissions.listAuditLog).toBe('core.audit.read');
  });

  it('render identically twice and as written on disk', () => {
    for (const { name } of surfaces) {
      const access = bundleOperations(name);
      const source = readFileSync(join(packageRoot, 'generated', name, 'schemas.ts'), 'utf8');
      const exported = [...source.matchAll(/^export const ([A-Za-z0-9_]+)/gm)].map(
        (m) => m[1] ?? '',
      );
      const map = mapOperationSchemas(
        access.map((operation) => operation.id),
        exported,
      );
      const once = renderOperations(name, map, access);
      expect(renderOperations(name, map, access)).toBe(once);
      expect(once).toBe(
        readFileSync(join(packageRoot, 'generated', name, 'operations.ts'), 'utf8'),
      );
    }
  });
});
