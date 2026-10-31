# Reference censuses

Index of the public-material censuses behind the foundation package (document 11, "Reference censuses"). Each census lists facts with a source URL and the date it was fetched. Facts a page did not state are marked "not stated"; pages that could not be read are marked "not reachable" with the date.

Scope rule: public pages only, no logins. Anything that needs a login is listed in section 2 and is not censused here.

## 1. Censuses in this folder

| Census | Path | Covers | Fetched | Status |
|---|---|---|---|---|
| Logestechs public API | `docs/references/logestechs/public-api.md` | `docs.logestechs.com`: authentication (`X-API-Key`, one key per customer account), base URL, all package and address endpoints named in the docs, request and response fields where the spec defines them, webhook payload and headers, status vocabulary (tracking node types, integration sources, the status-key endpoint), AWB label sizes, cancel and return rules | 2026-10-31 | Complete for public pages. Package status key values and several response bodies are behind a live key (see the census, section 13). |
| OTO public docs | `docs/references/oto/public-docs.md` | `tryoto.com` marketing, `docs.tryoto.com` (72-entry index), `apis.tryoto.com` (title only): authentication (refresh token, bearer, one-hour lifetime), the 76-endpoint REST list in 20 groups, webhook events (`orderStatus`, `shipmentError`, `newOrders`) and HMAC-SHA256 signing, dispatch vocabulary (build, optimise, simulate, assign), carrier counts (460+ vs the plan's 433), label types, status vocabulary as far as public | 2026-10-31 | Partial. Full order and shipment status list not public; `apis.tryoto.com` did not render its error and status pages. |

Pages each census could not read are listed in its own final sections.

## 2. Needs a login (owed before wave 1 design)

These are required by `docs/foundation-plan.md` section 9 ("Owed before wave 1 design") and cannot be done with public access.

| Item | Why it needs a login | Owed output | Status |
|---|---|---|---|
| admin-pro.logestechs.com screen census | The admin and dispatcher screens sit behind the Logestechs login. Public API docs do not cover them. | Screen census in `docs/references/logestechs/admin-screens.md` (to be written) | Not started. Needs an account with access. |
| OTO Flex app screens | OTO Flex (driver and fleet, planning, dispatch) is an app behind an OTO login. The public module pages describe features only. | Screen census in `docs/references/oto/flex-screens.md` (to be written) | Not started. Needs an account with access. |
| Bolesa 2 re-audit | The Bolesa 2 app (app.bolesa.net) is behind a login. The previous audit is in eeasynew `docs/research/bolesa-audit-2026-10`. | Re-audit, due after 2026-11-03 | Not started. Not due until 2026-11-03. |

Note: the OTO dispatch and routing vocabulary the brief asked for ("simulate, optimise, create, assign") is described publicly in the OTO census (section 7). The OTO Flex screen census still owes the in-app labels.

## 3. Existing material in another repository

These teardowns and audits live in `Marllow-git/eeasynew`. They are **not copied here**. Cite them by path in that repository when a decision depends on them.

| Path in eeasynew | Topic |
|---|---|
| `docs/delivery/01` | Logestechs teardown |
| `docs/delivery/03` | OTO teardown |
| `docs/research/*` | Including `bolesa-audit-2026-10`, `oto-platform-audit-2026-10`, `oto-carrier-audit-2026-10` |

## 4. How to use these censuses

- Cite the census file and the source URL, not this index, when a plan or ADR uses a fact.
- If a fact in a census conflicts with the foundation plan, the census wins for the public claim and the plan gets an update in its own PR. Known conflict: carrier catalogue, 433 in the plan, 460+ on OTO's public pages.
- Re-fetch before relying on a fact older than the next foundation document review. Facts here are dated 2026-10-31.
