# @eeasy-logistics/config

The validated runtime configuration (order PLAT-4, platform §3). It is the only code that reads environment variables; everything else receives a frozen, typed object (AGENTS.md hard rule).

## Server processes (api, worker)

```ts
import { loadConfig } from '@eeasy-logistics/config/node';

const config = loadConfig({ role }); // exits 78 (EX_CONFIG) listing every invalid variable
```

- `defineConfig(env, { role })` (from `@eeasy-logistics/config`) takes a plain record and never reads `process.env`; it validates every variable with Zod and throws one `ConfigError` listing every problem at once. Problems name the variable and the expected format, never the value.
- `loadConfig()` in `src/node.ts` is the single server entry point that reads `process.env`. It reads a `.env` file (first in the working directory, then at the workspace root) only when the process environment itself says `APP_ENV=local`; the file's own `APP_ENV` is ignored and the process environment wins over the file. `pnpm --filter api dev` sets `APP_ENV=local`.
- Secrets are `Secret` instances: they print as `[redacted]` through `String()`, `JSON.stringify` and `util.inspect`; call `reveal()` at the point of use only.
- An empty value counts as unset.

The variables, their formats and defaults are `serverVariables` in `src/server.ts`; `.env.example` at the repository root lists every one with a comment.

## Web and driver app (public values only)

```ts
import { publicConfig } from '@eeasy-logistics/config/web'; // NEXT_PUBLIC_* (apps/web)
import { publicConfig } from '@eeasy-logistics/config/driver'; // EXPO_PUBLIC_* (apps/driver)
```

Next.js and Expo inline a public variable at build time only where the code says `process.env.NEXT_PUBLIC_<NAME>` or `process.env.EXPO_PUBLIC_<NAME>` literally, so `src/web.ts` and `src/driver.ts` spell each variable out and hand the record to the pure schema in `src/public.ts`. Both were checked against a real build (the value appears in the client bundle; see the PLAT-4 plan §8). These values are readable by anyone who has the bundle or the app: never a secret. Client code must not import the package root or `/node`, which are server code.

## Per-account credentials at rest

`createCredentialsCipher(config.credentials)` gives `encrypt`, `decrypt` and `rotate` (plan 2.4, data §10): AES-256-GCM with a random 12-byte nonce. `encrypt` uses the active key and returns `{ keyId, blob }`: `blob` holds version, key id, nonce, tag and ciphertext for one `bytea` column, `keyId` goes in the row's `*_key_id` column. `decrypt` picks the key by the id inside the blob and throws a typed `CredentialsError` (`unknown_key_id`, `malformed`, `authentication_failed`). Pass the same optional `context` (for example `core_channel_connections:<id>`) to bind a blob to its row. `CREDENTIALS_KEYS` holds every key that must still decrypt; rotation adds a key, makes it active, re-encrypts with `rotate`, then removes the old key.

## Runtime

The package ships TypeScript source. `apps/api`'s compiled output imports it and Node (>= 22.18) runs it by type stripping, so relative imports carry `.ts` and only erasable syntax is allowed (`erasableSyntaxOnly`).
