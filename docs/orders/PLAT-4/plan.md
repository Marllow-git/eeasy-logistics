# PLAT-4 · Config module

- **Status:** planned (starts after PLAT-1 merges; rebase this branch onto main then)
- **Date:** 2026-10-31
- **Wave:** 0 (roadmap §1.1). **Depends on:** PLAT-1.
- **Lead:** architecture lead. **Executor:** Opus, own worktree. **Adversary:** yes (credentials encryption, production refusals).

## 0. Goal

`packages/config` is the only place any process reads the environment: every setting is declared once with a schema, read at boot, validated, and typed; a missing or malformed value fails startup naming the variable; production refuses to start without its required services; per-account credentials can be encrypted and decrypted with a key id so key rotation never bricks stored credentials.

## 1. Binding rules and ADRs

- AGENTS.md hard rule: configuration through the config module, never raw environment reads outside it; secrets never in code.
- Platform blueprint §3 (twelve-factor, schema validation, startup refusals, credentials encryption with key id, the eeasynew APP_KEY lesson), §2 (`--role worker`), §5 (`/health`, `/ready` are PLAT-5's).
- Integration architecture §1.4 and §11 (two homes for credentials; platform secrets through this module), §9 (stub adapters refused in production).
- Data architecture §10 (encryption at rest for per-account credentials, key id column).

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Schema library | Zod; one `defineConfig()` that takes `process.env` once in `main.ts` and returns a frozen typed object; anything else importing `process.env` fails the dependency-cruiser rule from PLAT-1 (add the rule) |
| 2.2 | Groups | `app` (env name `local|ci|staging|production`, role `api|worker|migrate`, port, public URLs), `db` (URL per role: owner, app, platform, maintenance; pool sizes), `redis`, `storage` (endpoint, bucket, keys, public read domain), `auth` (token signing key id and key, access and refresh lifetimes), `messaging` (provider `stub|meta|bsp`, credentials, `MESSAGING_DISABLED`), `push` (Expo token), `geo` (Hudhud key, VROOM URL, OSRM URL optional), `observability` (OTel endpoint, Sentry DSNs, PostHog key), `credentials` (encryption keys as a map of key id to key, `active_key_id`) |
| 2.3 | Production refusals | `app.env = production` refuses to start without: all four database URLs, Redis, storage, `auth` signing key, `credentials.active_key_id` present in the map, and either a real messaging provider or `MESSAGING_DISABLED=true`; any `stub` adapter selection refused in production |
| 2.4 | Credentials encryption | AES-256-GCM with a random 12-byte nonce, output `{ key_id, nonce, ciphertext, tag }` serialised to one `bytea`-ready buffer plus a `key_id` text; `encrypt(plain)` uses the active key; `decrypt(blob)` picks the key by id and fails with a typed error if the id is unknown; a `rotate` helper re-encrypts a blob under the active key; unit tests cover round trip, wrong key id, tampered tag, rotation |
| 2.5 | Error shape at boot | one `ConfigError` listing every invalid variable at once (not the first), printed without values, exit code 78 (`EX_CONFIG`) |
| 2.6 | Where it is used | `apps/api/src/main.ts` replaces its `PORT` read; `apps/web` reads only `NEXT_PUBLIC_*` through a `publicConfig()` helper from the same package with its own schema; `apps/driver` reads `EXPO_PUBLIC_*` likewise |
| 2.7 | Secrets at rest locally | `.env` (gitignored, PLAT-2) via `dotenv` only when `app.env = local`; never in `ci`, `staging` or `production` |

## 3. Build list

| Item | Delivers | Verify |
|---|---|---|
| A | `packages/config` schema groups and `defineConfig()` | unit tests: valid, missing, malformed, multiple errors reported together |
| B | Production refusal rules | tests per rule |
| C | Credentials encryption helpers | the four tests of 2.4 |
| D | `publicConfig()` for web and driver | tests |
| E | `apps/api/src/main.ts` uses the module; dependency-cruiser rule forbids `process.env` elsewhere | architecture test red on a planted read, green after |
| F | `.env.example` updated with every variable and a comment each (PLAT-2 file) | README section |

## 4. Commit plan

One commit per item, `PLAT-4: <item>`.

## 5. Exit criteria

- `pnpm turbo run typecheck lint test build` green.
- Starting the API with a missing variable exits 78 and prints the variable name, never a value.
- Starting with `APP_ENV=production` and a stub provider refuses.
- The architecture test proves no `process.env` read exists outside the config package (red then green shown).
- Encryption tests cover round trip, unknown key id, tampered data, rotation.

## 6. Not in this order

Reading secrets from a host secret store (OPS-1), key rotation runbook (OPS-2), any adapter that uses the credentials (INT orders), the health and readiness endpoints (PLAT-5).

## 7. Owner questions

None.
