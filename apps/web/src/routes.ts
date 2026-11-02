import type { Permission } from '@eeasy-logistics/contracts/unions';

// The route manifest of the merchant area (web §4; WEB-3 plan 2.2): every merchant route with the
// permission that opens it, the one that acts on it, its feature key and its navigation entry. The
// navigation renders from it filtered by the session (`getMe`: permissions and features), and each
// segment layout under /settings calls `requirePermission` with its route's `read` permission
// (src/server/authorization.ts). A route whose feature the account does not see is absent from the
// navigation and answers `notFound()`. Kept free of runtime imports so `node --test` runs it as is.

/** The `nav` catalogue keys the manifest labels its entries with. */
export type NavigationLabel = 'home' | 'settings_account';

/** Sidebar groups, in order; `settings` carries the `nav.settings` heading. */
export const navigationGroups = ['main', 'settings'] as const;
export type NavigationGroupKey = (typeof navigationGroups)[number];

export interface MerchantRoute {
  /** The route as the browser sees it (no route group). */
  readonly path: string;
  /** The permission that opens it; `null` for any signed-in member (`core.auth.self`). */
  readonly read: Permission | null;
  /** The permission its writes need, if it has any. */
  readonly write?: Permission;
  /** The account feature (K-6) that must be visible; none for the kernel's own screens. */
  readonly feature?: string;
  readonly navigation?: {
    readonly group: NavigationGroupKey;
    readonly label: NavigationLabel;
    readonly order: number;
  };
}

export const merchantRoutes = [
  { path: '/', read: null, navigation: { group: 'main', label: 'home', order: 0 } },
  {
    path: '/settings/account',
    read: 'core.account.read',
    write: 'core.account.manage',
    navigation: { group: 'settings', label: 'settings_account', order: 0 },
  },
] as const satisfies readonly MerchantRoute[];

export type MerchantPath = (typeof merchantRoutes)[number]['path'];

/** What the manifest reads of the session: `Me.permissions` and `Me.features`. */
export interface SessionGrants {
  readonly permissions?: readonly string[] | undefined;
  readonly features?: readonly string[] | undefined;
}

/** The manifest entry of `path`. */
export function routeOf(path: MerchantPath): MerchantRoute {
  const route = merchantRoutes.find((entry) => entry.path === path);
  if (route === undefined) throw new Error(`no route ${path} in the manifest`);
  return route;
}

/** The account sees the route's module (its feature, if it has one). */
export function featureVisible(route: MerchantRoute, grants: SessionGrants): boolean {
  return route.feature === undefined || (grants.features ?? []).includes(route.feature);
}

/** The member may open the route: the module is visible and the read permission is held. */
export function routeOpen(route: MerchantRoute, grants: SessionGrants): boolean {
  if (!featureVisible(route, grants)) return false;
  return route.read === null || (grants.permissions ?? []).includes(route.read);
}

export interface NavigationEntry {
  readonly href: string;
  readonly label: NavigationLabel;
}

/** The sidebar of this session: the open routes per group, in order; empty groups dropped. */
export function navigationFor(
  grants: SessionGrants,
): { group: NavigationGroupKey; items: NavigationEntry[] }[] {
  return navigationGroups
    .map((group) => ({
      group,
      items: merchantRoutes
        .filter((route) => route.navigation.group === group && routeOpen(route, grants))
        .toSorted((a, b) => a.navigation.order - b.navigation.order)
        .map((route) => ({ href: route.path, label: route.navigation.label })),
    }))
    .filter((group) => group.items.length > 0);
}
