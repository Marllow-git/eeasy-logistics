import { Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import type { RoleSurface } from '../schema/roles.js';

// Permission resolution (PLAT-10 plan 2.4; identity and tenancy §2, §4): a principal holds the
// union of the bundles its token's `roles` claim names, each counted only on its own surface. The
// bundles are core_roles (seeded from docs/contracts/roles.yaml by migration 0008), loaded once at
// boot through the platform pool into an immutable map: system roles only in wave 0; the
// custom-roles order adds invalidation.

/** One role bundle as core_roles holds it. */
export interface RoleBundle {
  readonly key: string;
  readonly surface: RoleSurface;
  /** True when the role acts only on the membership's `site_ids` (site staff, warehouse, cashier). */
  readonly siteScoped: boolean;
  readonly permissions: ReadonlySet<string>;
}

/**
 * How a principal holds a permission: through a bundle that is not site-scoped (`all`), or only
 * through site-scoped bundles (`sites`), which act on the token's `sites` claim alone.
 */
export type Grant = 'all' | 'sites';

/**
 * The bundle key a token's role names on a surface. Staff and driver tokens carry the bundle key
 * itself; a platform token carries the platform staff role of `core_platform_staff.role`
 * (`super_admin`, `admin`, `support`, data §2.1), whose bundle is `platform_<role>`.
 */
export function bundleKeyOf(surface: Principal['kind'], role: string): string {
  return surface === 'platform' ? `platform_${role}` : role;
}

/** Unknown role names logged once each, up to this many (the claim is signed, but bounded). */
const maxLoggedRoles = 100;

export class PermissionResolver {
  readonly bundles: ReadonlyMap<string, RoleBundle>;
  readonly #grants = new WeakMap<Principal, ReadonlyMap<string, Grant>>();
  readonly #logged = new Set<string>();
  readonly #logger = new Logger('Permissions');

  constructor(bundles: Iterable<RoleBundle>) {
    const map = new Map<string, RoleBundle>();
    for (const bundle of bundles) {
      map.set(bundle.key, Object.freeze({ ...bundle, permissions: new Set(bundle.permissions) }));
    }
    this.bundles = map;
    if (map.size === 0) {
      this.#logger.warn('core_roles is empty: every permission check refuses');
    }
  }

  /**
   * The permissions of `principal` with how it holds each, computed once per principal (one per
   * request) and cached. A role that names no bundle, or a bundle of another surface, is ignored
   * and logged once.
   */
  grantsOf(principal: Principal): ReadonlyMap<string, Grant> {
    const cached = this.#grants.get(principal);
    if (cached !== undefined) return cached;
    const grants = new Map<string, Grant>();
    for (const role of principal.roles) {
      const bundle = this.bundles.get(bundleKeyOf(principal.kind, role));
      if (bundle === undefined || bundle.surface !== principal.kind) {
        this.#unknown(principal.kind, role);
        continue;
      }
      for (const permission of bundle.permissions) {
        if (!bundle.siteScoped) grants.set(permission, 'all');
        else if (!grants.has(permission)) grants.set(permission, 'sites');
      }
    }
    this.#grants.set(principal, grants);
    return grants;
  }

  #unknown(surface: Principal['kind'], role: string): void {
    const key = `${surface}:${role}`;
    if (this.#logged.has(key) || this.#logged.size >= maxLoggedRoles) return;
    this.#logged.add(key);
    this.#logger.warn(
      `Ignoring role ${JSON.stringify(role)} on a ${surface} token: no such bundle`,
    );
  }
}

/** The resolver, provided by `RequestFrameModule.forRoot` when the platform pool exists. */
export const PERMISSION_RESOLVER = Symbol('PERMISSION_RESOLVER');
