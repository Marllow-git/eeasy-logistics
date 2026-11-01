# ADR-0038: Serve the platform console from its own application and hostname

- **Status:** accepted
- **Date:** 2026-11-01
- **Deciders:** owner
- **Source:** owner ruling of 2026-11-01 ("we will be having separate admin panel and customer portal"; "we will be using 2 apps in apps/web and apps/admin"); closes web architecture open question 2 and register row Q-22; amends ADR-0032

## Context

Document 7 placed the platform console inside `apps/web` as the `(platform)` route group under `/platform`, with its own cookie, root layout and middleware branch, and proposed a separate hostname as an open question. One application means one JavaScript bundle family: Next.js splits code per route, but the shared route manifest, the generated client package and the `platform` i18n namespace would still name every admin route, operation and permission inside the merchant deployment. The owner does not want a person who reads the merchant bundle to learn the admin surface. Authorization does not depend on this (the platform session, mandatory TOTP and permission checks protect the API), so the goal is a smaller reconnaissance surface and a hard deployment boundary, not a new security control.

## Decision

- Two Next.js applications: `apps/web` serves the merchant portal, the sign-in doors for merchant staff and the recipient pages; `apps/admin` serves the platform console and its sign-in door. Each is its own standalone image, container and hostname (`admin.<domain>` for the console; the exact names follow the brand ruling, Q-21).
- `packages/contracts` exposes one entry point per surface (PLAT-15). `apps/web` may import `staff`, `recipient`, `http` and `unions`; `apps/admin` may import `platform`, `http` and `unions`. The architecture test of each app fails on any other surface, so the platform operations are absent from the merchant bundle by construction.
- The edge routes `/v1/platform/*` only on the admin hostname and `/v1/staff/*` and `/v1/recipient/*` only on the web hostnames; a path routed to the wrong hostname answers `404` at the edge. The platform cookie is host-only on the admin hostname. ADR-0032's same-origin rule holds per application.
- The admin hostname may additionally sit behind an IP allowlist or an identity-aware proxy at the edge (owner's call in OPS-1); nothing in the application assumes it.
- Shared code stays in packages: `packages/ui`, `packages/i18n`, `packages/config` (`publicConfig()` per app), the session and refresh helpers that WEB-2 writes move into a package both apps import. Route manifests, navigation and the `platform` i18n namespace live only in `apps/admin`.
- The API stays one deployment. Platform and staff surfaces share the database, tenancy frame and outbox; a second API has no security gain over the per-host edge rule.

## Consequences

- One more application to build, test and deploy: a third image, an `admin` service in the Compose profiles, an `admin-build-census` lane beside `web-build-census`, and the Playwright census in `ar` and `en` for the console.
- The `(platform)` route group and `/platform/*` paths leave document 7; WEB-4 builds in `apps/admin`. The web middleware loses its platform branch; `apps/admin` has its own.
- A person who is both platform staff and a merchant member uses two hostnames; the two sessions were already independent.
- Nothing changes in the API, the contracts or the data model. The `X-EL-Client: web` header check of ADR-0032 accepts the same value from both applications; the `Origin` check accepts both hostnames.
- Done now, before any UI order, the cost is one scaffold order (WEB-19). Done later it would mean moving every admin screen.

## Alternatives considered

- One application with the platform area on a second hostname (document 7's proposal): keeps the shared manifest, client package and namespace in one bundle family; the leak the owner wants closed stays open.
- One application with build-time stripping of the platform group: fragile, and a single missed import undoes it silently.
- A separate API deployment for the platform surface: operational cost for no gain; the edge already refuses the platform paths on the merchant hostname.
