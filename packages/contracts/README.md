# @eeasy-logistics/contracts

The typed seam between the API, the web app and the driver app (ADR-0003). The OpenAPI files in `docs/contracts/openapi/` are the source of truth; everything under `generated/` is built from them, never edited and never committed (document 3 §9, PLAT-15).

## Scripts

| Command | What it does |
|---|---|
| `pnpm --filter contracts build` | `build:bundle` (one Redocly bundle per surface in `generated/openapi/`, the three staff files joined), `build:unions` (`generated/unions.ts`), `build:client` (Orval into `generated/<surface>/`) |
| `pnpm --filter contracts lint` | Redocly with `docs/contracts/redocly.yaml` and the repository rules of `redocly/plugin.js`, then ESLint |
| `pnpm --filter contracts lint:bundles` | Redocly recommended rules over the five bundles |
| `pnpm --filter contracts typecheck` | `tsc` over `src`, `test`, `scripts` and `generated` |
| `pnpm --filter contracts test` | Vitest (lint rules, fetcher, unions), then the dependency-cruiser architecture test |

Turborepo runs `build` before this package's own `typecheck`, `lint` and `test`, and before those tasks in `apps/web` and `apps/driver` (`^build`), so a fresh checkout needs no manual step.

## Repository lint rules (`docs/contracts/redocly.yaml`)

- Every `$ref` resolves; `operationId` unique; `x-wave` an integer 0 to 4; `x-permission` present, shaped `<module>.<resource>.<action>` and listed in `docs/contracts/permissions.yaml` (kept equal to README §11 by a test).
- Every `post`, `put`, `patch` and `delete` declares `Idempotency-Key`, unless its `operationId` is in the `exempt` list of `eeasy/idempotency-key` (README §3: session doors under `/auth/`, driver locations, the cash PIN check, read-only computations sent as `POST`). Outbound `webhooks:` are not checked.
- `x-cross-tenant` only on the platform surface. A `text/event-stream` operation lists its event names in `x-sse-events`.

## Entry points

| Import | Holds | Used by |
|---|---|---|
| `@eeasy-logistics/contracts/staff` | model types; `client`, `schemas` (Zod), `hooks` (TanStack Query) namespaces | `apps/web` |
| `@eeasy-logistics/contracts/recipient` | model types; `client`, `schemas` | `apps/web` |
| `@eeasy-logistics/contracts/platform`, `/public` | as staff | not `apps/web` until the admin-console decision; `/public` for integrators |
| `@eeasy-logistics/contracts/driver` | model types; `client`, `schemas`; no hooks, no MSW | `apps/driver` |
| `@eeasy-logistics/contracts/<staff,platform,public>/mocks` | MSW handlers and mock factories, tests only | test code |
| `@eeasy-logistics/contracts/http` | `createFetcher`, `apiFetch` (the Orval mutator), `ApiError` | every client |
| `@eeasy-logistics/contracts/unions` | `Permission`, `StreamEventName`, `ErrorCode` and their runtime lists | every client |

The architecture tests of `apps/web` and `apps/driver` enforce the "Used by" column.

## Calling the API

```ts
import { createFetcher } from '@eeasy-logistics/contracts/http';
import { client } from '@eeasy-logistics/contracts/staff';

const fetcher = createFetcher({ baseUrl: '', locale: 'ar' }); // same origin in the browser (ADR-0032)
const { data } = await client.listSites({ limit: 50 }, { fetcher });
```

- `baseUrl` is the origin only; generated paths already carry `/v1/<surface>`. Server code passes `API_INTERNAL_URL` from `packages/config` and the forwarded cookie through `headers`; nothing in this package reads the environment.
- Every call sends `Accept-Language` (when `locale` is set) and a fresh `X-Request-Id`; every non-GET sends `X-EL-Client: web` unless `webClient: false` (the driver app). `Idempotency-Key` and `If-Match` are operation parameters the caller passes.
- A non-2xx answer throws `ApiError` (`status`, `code: ErrorCode | 'unexpected_response'`, `message`, `details`, `requestId`); network failures reject unchanged. No retry and no token refresh here (WEB-1 wraps the fetcher).
- Hooks take the fetcher through `{ request: { fetcher } }`.
