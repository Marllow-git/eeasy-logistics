import type { Permission } from '@eeasy-logistics/contracts/unions';

// The route manifest of the platform console (web §4; WEB-4 plan 2.1, in WEB-3's shape: the
// paths of web §1 without the /platform segment, ADR-0038): every console route with the
// permission that opens it, the one its writes need, and its navigation entry. The navigation
// renders from it filtered by `platformGetMe.permissions`, and each segment layout calls
// `requirePermission` with its route (src/server/authorization.ts). Platform staff belong to no
// account, so no route has a feature key. Kept free of runtime imports so `node --test` runs it.

/** The `platform.nav` catalogue keys the manifest labels its entries with. */
export type NavigationLabel = 'home' | 'accounts' | 'rollout';

/** Sidebar groups, in order; all but `main` carry the `platform.nav.groups.<group>` heading. */
export const navigationGroups = ['main', 'accounts', 'operations', 'governance'] as const;
export type NavigationGroupKey = (typeof navigationGroups)[number];

export interface ConsoleRoute {
  /** The route as the browser sees it (no route group); a dynamic segment's routes sit under it. */
  readonly path: string;
  /** The permission that opens it; `null` for any signed-in staff member. */
  readonly read: Permission | null;
  /** The permission its writes need, if it has any. */
  readonly write?: Permission;
  readonly navigation?: {
    readonly group: NavigationGroupKey;
    readonly label: NavigationLabel;
    readonly order: number;
    /** Current on the pages under it too (the list and its detail pages). */
    readonly prefix?: boolean;
  };
}

export const consoleRoutes = [
  { path: '/', read: null, navigation: { group: 'main', label: 'home', order: 0 } },
  // The list, each account and its tabs (`/accounts/[accountId]/…`): the tabs' own writes need
  // their own permissions (provision, suspend, flags), which the controls check.
  {
    path: '/accounts',
    read: 'platform.accounts.read',
    write: 'platform.accounts.provision',
    navigation: { group: 'accounts', label: 'accounts', order: 0, prefix: true },
  },
  // The provisioning form is a write screen: its layout gates on the provision permission.
  {
    path: '/accounts/new',
    read: 'platform.accounts.provision',
    write: 'platform.accounts.provision',
  },
  // Rollout modes open to every reader of accounts; the change is the super admin's (ADR-0006).
  {
    path: '/rollout',
    read: 'platform.accounts.read',
    write: 'platform.rollout.manage',
    navigation: { group: 'accounts', label: 'rollout', order: 1 },
  },
] as const satisfies readonly ConsoleRoute[];

export type ConsolePath = (typeof consoleRoutes)[number]['path'];
type NavigableRoute = Extract<(typeof consoleRoutes)[number], { navigation: object }>;

/** What the manifest reads of the session: `PlatformMe.permissions`. */
export interface SessionGrants {
  readonly permissions?: readonly string[] | undefined;
}

/** The manifest entry of `path`. */
export function routeOf(path: ConsolePath): ConsoleRoute {
  const route = consoleRoutes.find((entry) => entry.path === path);
  if (route === undefined) throw new Error(`no route ${path} in the manifest`);
  return route;
}

/** The staff member may open the route: the read permission is held (or none is needed). */
export function routeOpen(route: ConsoleRoute, grants: SessionGrants): boolean {
  return route.read === null || (grants.permissions ?? []).includes(route.read);
}

export interface NavigationEntry {
  readonly href: string;
  readonly label: NavigationLabel;
  readonly prefix: boolean;
}

/** The sidebar of this session: the open routes per group, in order; empty groups dropped. */
export function navigationFor(
  grants: SessionGrants,
): { group: NavigationGroupKey; items: NavigationEntry[] }[] {
  return navigationGroups
    .map((group) => ({
      group,
      items: consoleRoutes
        .filter(
          (route): route is NavigableRoute =>
            'navigation' in route && route.navigation.group === group && routeOpen(route, grants),
        )
        .toSorted((a, b) => a.navigation.order - b.navigation.order)
        .map((route) => ({
          href: route.path,
          label: route.navigation.label,
          prefix: 'prefix' in route.navigation && route.navigation.prefix,
        })),
    }))
    .filter((group) => group.items.length > 0);
}

/** An area of the home page: a navigable route other than the home itself. */
export type AreaEntry = NavigationEntry & { readonly label: Exclude<NavigationLabel, 'home'> };

/** The areas of the home page: every navigable route this session opens but the home itself. */
export function homeAreas(grants: SessionGrants): AreaEntry[] {
  return navigationFor(grants)
    .flatMap((group) => group.items)
    .filter((entry): entry is AreaEntry => entry.label !== 'home');
}
