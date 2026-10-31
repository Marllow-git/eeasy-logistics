# Architecture decision records

One decision per file. Status `accepted` means the owner ruled it (in eeasynew between 2026-09-12 and 2026-10-31, or in this repository); `proposed` means the architecture lead recommends it and the owner has not yet accepted. A decision changes only through a new ADR that supersedes the old one. Template: `template.md`.

| ADR | Title | Status |
|---|---|---|
| [0000](0000-record-architecture-decisions.md) | Record architecture decisions as ADRs | accepted |
| [0001](0001-standalone-product-separate-from-eeasynew.md) | Build eeasy-logistics as a standalone product, separate from eeasynew | accepted |
| [0002](0002-scope-last-mile-and-wms.md) | Scope the product as last-mile delivery and WMS together | accepted |
| [0003](0003-one-monorepo-nextjs-nestjs.md) | Use one monorepo holding the Next.js web app and the NestJS API | accepted |
| [0004](0004-new-driver-app.md) | Build a new driver app instead of continuing the eeasy-app driver work | accepted |
| [0005](0005-own-fleets-only.md) | Serve merchants' own fleets only; keep the executor-fleet seam dormant | accepted |
| [0006](0006-allowlist-rollout-with-provisioning-door.md) | Roll out features by allowlist with a staff provisioning door from day one | accepted |
| [0007](0007-driver-cash-custody-logestechs-model.md) | Model driver cash custody after Logestechs | accepted |
| [0008](0008-offline-first-driver-app-with-outbox.md) | Make the driver app offline-first with an idempotent outbox | accepted |
| [0009](0009-tracking-by-polling-and-sse.md) | Deliver live tracking by polling and server-sent events, not sockets | accepted |
| [0010](0010-route-optimisation-vroom-over-hudhud.md) | Optimise routes with VROOM over a Hudhud distance matrix behind a RouteOptimizer port | accepted |
| [0011](0011-stock-as-double-entry-ledger.md) | Record stock as a double-entry, append-only movements ledger with projections | accepted |
| [0012](0012-tracking-mode-and-location-tree.md) | Track products by mode none, lot or serial, in a location tree with totes | accepted |
| [0013](0013-one-way-channel-stock-sync-via-outbox.md) | Publish stock to channels one way, WMS to channel, through an outbox | accepted |
| [0014](0014-carrier-shipments-at-pack-time-via-eeasy-shipping.md) | Create carrier shipments at pack time through the Eeasy shipping API; own fleet is a card beside carriers | accepted |
| [0015](0015-provision-storage-and-coverage-before-first-use.md) | Provision object storage and own-fleet coverage before the first driver signs in | accepted |
| [0016](0016-arabic-and-english-everywhere.md) | Ship every string in Arabic and English with Gregorian dates and Western digits | accepted |
| [0017](0017-digital-cod-tap-to-phone-owner-gated.md) | Gate digital COD on owner approval; use tap-to-phone, never Bluetooth POS | accepted |
| [0018](0018-one-sites-concept.md) | Model branches and warehouses as one sites concept | accepted |
| [0019](0019-postgresql-with-postgis.md) | Use PostgreSQL 16 with PostGIS | accepted |
| [0020](0020-drizzle-orm-and-sql-migrations.md) | Use Drizzle ORM with SQL migrations | accepted |
| [0021](0021-driver-app-inside-the-monorepo.md) | Keep the driver app inside the monorepo as apps/driver | accepted |
| [0022](0022-containers-on-gulf-region-host.md) | Run production as containers on a Gulf-region host, with Compose for development | accepted |
| [0023](0023-own-identity-no-eeasy-dependency.md) | Run our own identity; an Eeasy sign-in link is an option, not a dependency | accepted |
| [0024](0024-side-effects-through-outbox-and-queue.md) | Route every cross-system side effect through an outbox and a queue | accepted |
| [0025](0025-tenancy-by-account-id-enforced-structurally.md) | Isolate tenants by account_id on every operational row, enforced structurally | accepted |
| [0026](0026-bounded-contexts-and-module-boundaries.md) | Split the API into three bounded contexts with enforced module boundaries | proposed |
| [0027](0027-domain-event-envelope-and-versioning.md) | Publish domain events in one versioned envelope, ordered per aggregate | proposed |
| [0028](0028-driver-location-pings-bypass-the-outbox.md) | Write driver location pings to a bounded ring and fan out by Redis, not through the outbox | proposed |

## Groups

- **Product decisions by the owner (2026-10-31):** 0001 standalone, 0002 scope, 0003 monorepo, 0004 new driver app, 0023 own identity.
- **Rulings carried over from eeasynew:** 0005 own fleets, 0006 allowlist rollout, 0007 cash custody, 0008 offline outbox, 0009 tracking by polling and SSE, 0010 VROOM over Hudhud, 0011 stock ledger, 0012 tracking mode and locations, 0013 one-way channel sync, 0014 pack-time shipments, 0015 storage and coverage first, 0016 Arabic and English, 0017 tap-to-phone gated.
- **Proposed by the architecture lead, accepted by the owner on merging PR #1 (2026-10-31):** 0018 one sites concept, 0019 PostgreSQL with PostGIS, 0020 Drizzle, 0021 driver app in the monorepo, 0022 containers on a Gulf host, 0024 outbox and queue, 0025 tenancy by account_id.
- **Proposed with the domain model (document 2):** 0026 bounded contexts and module boundaries, 0027 domain event envelope and versioning, 0028 driver location pings bypass the outbox.
