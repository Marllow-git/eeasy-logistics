import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const roleScopes = ['account', 'platform'] as const;
export type RoleScope = (typeof roleScopes)[number];
export const roleSurfaces = ['staff', 'driver', 'platform'] as const;
export type RoleSurface = (typeof roleSurfaces)[number];

/**
 * `core_roles`: the role bundles (data §2.1; identity and tenancy §2; PLAT-10 plan 2.3). A platform
 * table, exempt from tenancy (data §2.4): system roles in wave 0, seeded by migration 0008 from
 * docs/contracts/roles.yaml; the runtime roles may only read it. `surface` names where a token may
 * carry the role, `site_scoped` restricts it to the membership's `site_ids`; `custom` is for the
 * account-defined roles of a later order.
 */
export const coreRoles = pgTable(
  'core_roles',
  {
    key: text('key').primaryKey(),
    scope: text('scope', { enum: roleScopes }).notNull(),
    surface: text('surface', { enum: roleSurfaces }).notNull(),
    siteScoped: boolean('site_scoped').notNull(),
    permissions: text('permissions').array().notNull(),
    custom: boolean('custom').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('core_roles_scope_check', sql`${table.scope} IN ('account', 'platform')`),
    check('core_roles_surface_check', sql`${table.surface} IN ('staff', 'driver', 'platform')`),
  ],
);
