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

## 8. Executor notes (filled by the executor)

### 8.1 Skills and documents consulted

- `vercel:knowledge-update` (dated 2026-09-18) and `vercel:nextjs` (plugin 0.50.0), before touching `apps/web`. The Next.js guide "Environment variables" (nextjs.org, last updated 2026-08-25): a `NEXT_PUBLIC_*` value is inlined at `next build` only where the code says `process.env.NEXT_PUBLIC_<NAME>` literally. Dynamic lookups (`process.env[name]`, `const env = process.env`) are not inlined, and the value is fixed at build time.
- `expo:expo-overview`, before touching `apps/driver`. The Expo guide "Environment variables": only static dot notation `process.env.EXPO_PUBLIC_<NAME>` is inlined. Bracket access and destructuring are not. Code under `node_modules` is not inlined. SDK 58 loads only `.env`, `.env.local`, `.env.development*` and `.env.production*`.
- Verified on real builds rather than taken from the docs. A scratch client page and a scratch driver screen (both deleted afterwards) called `publicConfig()`. `next build` with `NEXT_PUBLIC_POSTHOG_KEY` set put the value in a client chunk, with no `process.env.NEXT_PUBLIC_*` left behind. `expo export --platform android --no-bytecode` produced `EXPO_PUBLIC_API_URL: "https://inline-probe-7731.example.test"` and `undefined` for the unset variables. Inlining therefore works inside the workspace package: Metro resolves it to `packages/config`, outside `node_modules`.
- npm registry on 2026-10-31: zod 4.6.7 and dotenv 18.0.9, the latest stable versions, pinned exactly.

### 8.2 Interpretations the lead should check

1. **Three files read `process.env`, not one.** The server entry `src/node.ts` (`loadConfig()`, used by `main.ts`) is the only one on the server side. The browser and app bundlers inline only literal `process.env.NEXT_PUBLIC_X` and `process.env.EXPO_PUBLIC_X` reads (8.1), so `src/web.ts` and `src/driver.ts` spell their variables out. Each passes a plain record to a pure schema in `src/public.ts`, the same shape `defineConfig(env)` takes. The ESLint exemption lists exactly these three files.
2. **The rule is two tools.** dependency-cruiser sees imports only, so it cannot see a global `process.env`. The shared rule set `dependency-cruiser.shared.cjs` runs in every workspace's `test:architecture` (api, web, driver, config, db, i18n, ui). It forbids importing the `process` module and limits web and driver to `config/web` and `config/driver`. The shared ESLint config restricts the global `process` in every workspace. The red runs show both (amended after review, section 9).
3. **Role.** `app.role` comes from `--role`, as `main.ts` already parses it (platform §2), and is passed as `defineConfig(env, { role })`. It is not an environment variable. The config type allows `migrate`, but `parseRole` still accepts only `api|worker` until PLAT-5 adds the migrate job.
4. **Messaging provider.** When unset it resolves to `stub` in `local` and `ci` and to `null` in `staging` and `production`. Production refuses an explicit `stub` even with `MESSAGING_DISABLED=true`, and with no provider set it needs `MESSAGING_DISABLED=true`. `MESSAGING_PROVIDER` is the only adapter selector today; `adapterSelectors` in `refusals.ts` is where INT orders add theirs.
5. **Required versus production-required.** Only `APP_ENV` is required in every environment. The 2.3 list is required in production only, so the API still boots locally before PLAT-2 and PLAT-5 exist. Variables that make sense only together are enforced in every environment: the signing key and its id, the credentials keys and the active id, and the four storage variables. `meta` and `bsp` need a token and a sender id.
6. **Credentials blob** (2.4). Layout: `version | key id length | key id | nonce(12) | tag(16) | ciphertext`. The header is authenticated as additional data, so relabelling the key id fails. A required `context` string, `<table>:<row id>`, is also authenticated, which stops a blob being copied between rows (required after review, section 9). `rotate` always re-encrypts. Callers that want to skip blobs already under the active key compare `*_key_id` first.
7. **Secrets are wrapped** in `Secret` (prints `[redacted]`, read with `reveal()`), so logging the config object cannot leak a secret.
8. **Runtime of the package.** It ships TypeScript source with `.ts` relative imports. The compiled API runs it through Node's type stripping (Node ≥ 22.18, no warning on 22.23.4), and the package sets `erasableSyntaxOnly`. Consumers accept the `.ts` imports because the shared tsconfig now sets `rewriteRelativeImportExtensions`.
9. **`.env.example`.** No file existed on this branch or on `origin/feat/PLAT-2-compose-profiles` at the time, so this order created it. The lead reconciles it with PLAT-2's Compose ports and MinIO credentials. The storage lines are empty because the four go together and the file must boot as copied. Web and driver lines go in `apps/web/.env.local` and `apps/driver/.env`, because those tools read their own directories.

### 8.3 Not done here

The web server's own variables (`API_INTERNAL_URL`, web §2) are not in this order. 2.6 limits `apps/web` to `NEXT_PUBLIC_*`, so the order that adds server-side fetches adds them.

## 9. Review

Adversary pass, 2026-10-31: no critical or high findings; one medium and four low. All fixed on this branch.

| # | Severity | Finding | Status |
|---|---|---|---|
| R-1 | medium | `node.ts` could take `APP_ENV` from the `.env` file, so a stray file could switch itself on. The file is now read only when the process environment itself says `APP_ENV=local`, and the file's own `APP_ENV` is dropped. `node.test.ts` is updated. A root `.dockerignore` keeps `.env*`, `.local/`, `node_modules/` and `.git/` out of build contexts. The api `dev` script sets `APP_ENV=local`. | fixed |
| R-2 | low | `context` in `encrypt`, `decrypt` and `rotate` is now required and must match `<table>:<row id>`; otherwise a typed `invalid_context` error is thrown. Tests are updated, with a test for each of the three calls. | fixed |
| R-3 | low | Lint bypasses are closed. The shared ESLint config forbids `process['env']` and every other `process` member except `argv`, `stdout`, `stderr`, `exit`, `execPath` and `cwd`. It forbids aliasing or passing `process`, every import of `process` and `node:process`, and `require` or `import()` of them. Only the three config entry files are exempt. The dependency-cruiser environment rule now comes from one shared file and runs in api, web, driver, config, db, i18n and ui. | fixed |
| R-4 | low | The web dependency-cruiser scope now covers the whole app, `next.config.ts` included (`from: {}` minus `packages/config`). The driver gets the same rule for `config/driver`. | fixed |
| R-5 | low | Production hardening. Production now requires `PUBLIC_WEB_URL`, `rediss://` for Redis and `https://` for `STORAGE_ENDPOINT` and `OTEL_EXPORTER_OTLP_ENDPOINT`; plain `redis://` and `http://` are allowed only outside production, for the Compose services. A non-secret URL may not carry a password (a user name alone, as in a Sentry DSN, is allowed); the `Secret` database and Redis URLs are exempt. `AUTH_SIGNING_KEY` needs at least 16 distinct characters, in every environment. integrations §9 now says `APP_ENV=production` instead of `NODE_ENV=production` (the reviewer cited §11; the sentence is in §9). | fixed |
