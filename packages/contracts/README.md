# @eeasy-logistics/contracts

The typed seam between the API, the web app and the driver app (ADR-0003). The OpenAPI files in `docs/contracts/openapi/` are the source of truth; everything under `generated/` is built from them, never edited and never committed (document 3 §9, PLAT-15).

## Scripts

| Command | What it does |
|---|---|
| `pnpm --filter contracts build` | `build:bundle` (one Redocly bundle per surface in `generated/openapi/`, the three staff files joined), `build:unions` (`generated/unions.ts`), `build:client` (Orval into `generated/<surface>/`); `build:operations` (`zod.coerce.boolean()` → `zod.stringbool()` in each `schemas.ts`, then `generated/<surface>/operations.ts`) |
| `pnpm --filter contracts lint` | Redocly with `docs/contracts/redocly.yaml` and the repository rules of `redocly/plugin.js`, then ESLint |
| `pnpm --filter contracts lint:bundles` | Redocly recommended rules over the five bundles |
| `pnpm --filter contracts typecheck` | `tsc` over `src`, `test`, `scripts` and `generated` |
| `pnpm --filter contracts test` | Vitest (lint rules, fetcher, unions, contract-harness self-test), then the dependency-cruiser architecture test |
| `pnpm --filter contracts test:contract -- --api http://127.0.0.1:3000` | The contract tests against a running API (below); `CONTRACT_API_URL` when `--api` is absent |

Turborepo runs `build` before this package's own `typecheck`, `lint` and `test`, and before those tasks in `apps/web` and `apps/driver` (`^build`), so a fresh checkout needs no manual step.

## Repository lint rules (`docs/contracts/redocly.yaml`)

- Every `$ref` resolves; `operationId` unique; `x-wave` an integer 0 to 4; `x-permission` present, shaped `<module>.<resource>.<action>` and listed in `docs/contracts/permissions.yaml` (kept equal to README §11 by a test).
- Every `post`, `put`, `patch` and `delete` declares `Idempotency-Key`, unless its `operationId` is in the `exempt` list of `eeasy/idempotency-key` (README §3: session doors under `/auth/`, driver locations, the cash PIN check, read-only computations sent as `POST`). Outbound `webhooks:` are not checked.
- `x-cross-tenant` only on the platform surface. A `text/event-stream` operation lists its event names in `x-sse-events`.

## Entry points

| Import | Holds | Used by |
|---|---|---|
| `@eeasy-logistics/contracts/staff` | model types; `client`, `schemas` (Zod), `hooks` (TanStack Query) namespaces; `operationSchemas` | `apps/web` |
| `@eeasy-logistics/contracts/recipient` | model types; `client`, `schemas`; `operationSchemas` | `apps/web` |
| `@eeasy-logistics/contracts/platform`, `/public` | as staff | never `apps/web` (the admin app, ADR-0038); `/public` for integrators |
| `@eeasy-logistics/contracts/driver` | model types; `client`, `schemas`; `operationSchemas`; no hooks | `apps/driver` |
| `@eeasy-logistics/contracts/<surface>/schemas` (all five) | server-safe: model types and enum constants, `schemas` (Zod), `operationSchemas`; no client, hooks or MSW (architecture rule `server-safe-schemas-entries`) | `apps/api` controllers and presenters (PLAT-6, A-17) |
| `@eeasy-logistics/contracts/<surface>/mocks` (all five) | MSW handlers and mock factories, faker seeded on import (`seedMocks(n)` reseeds); tests only | test code (architecture rules forbid it in app code) |
| `@eeasy-logistics/contracts/http` | `createFetcher`, `apiFetch` (the Orval mutator), `ApiError` | every client |
| `@eeasy-logistics/contracts/unions` | `Permission`, `StreamEventName`, `ErrorCode`, their runtime lists and `isStreamEventName` (SSE families such as `delivery.order.*` expanded from domain-model §6.3) | every client |

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

## Contract tests (`test/contract/`, `test/scenarios/`)

`test:contract` checks the running API against the bundles (document 3 §9, handbook 03 "Contract" row). It first asks the API for `GET /health`, then runs every scenario and prints a coverage table of operations with and without a passing scenario (advisory). CI runs it in `web-build-census` against the API on port 3000.

- A scenario is one file per operation, `test/scenarios/<surface>/<operationId>.ts`, added by the order that implements the operation:

  ```ts
  import { client } from '../../../src/staff.ts';
  import { defineScenario } from '../../contract/scenario.ts';

  export default defineScenario({
    expectedStatus: 200,
    run: ({ fetcher }) => client.listSites({ limit: 10 }, { fetcher }),
  });
  ```

  `run` calls the generated client with the `fetcher` it receives (signing in first if it must); an `ApiError` is expected for an error status. Every answer of a documented operation the scenario caused is checked, not only the last.
- A response fails on: a status the operation does not document (exact, `4XX` range or `default`), a field no schema declares (`undocumented_field`, even where the schema leaves `additionalProperties` unset; an explicit `additionalProperties` is a documented open map), an error `code` outside `ErrorCode`, a schema mismatch (ajv, JSON Schema 2020-12 with formats), an undocumented content type, or a missing or malformed documented header.
- The self-test (`test/contract/self-test.test.ts`) plays the API in process for `platformListAccounts` and proves each of those checks red; it also runs in `test`.

## Operation schemas (plan 2.12, A-17)

- `schemas` holds Orval's Zod schemas per operation: `<OperationId>Params` (path), `<OperationId>QueryParams`, `<OperationId>Header`, `<OperationId>Body`, and one `<OperationId><status>Response` per documented status. Request schemas are strict (an undeclared field such as `account_id` is refused, K-3); path and query values are coerced from strings to numbers, and query booleans read `true`/`false` (`zod.stringbool`); bodies are not coerced; responses are not strict (the contract tests catch undocumented fields).
- `operationSchemas` keys the same schemas by operationId: `operationSchemas.platformListAccounts.query.parse({ limit: '50' })` gives `{ limit: 50 }`. It holds every operation of the bundle, so `apps/api`'s `ContractPipe` (PLAT-6) looks its operation up by id.
- Response TypeScript types per operation and status are in the `client` namespace (`platformListAccountsResponse200`, ...).

