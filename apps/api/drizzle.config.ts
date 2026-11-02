// drizzle-kit configuration (ADR-0020, data §1.2, §11). Only `drizzle-kit generate` is used: it
// writes SQL into ./drizzle from the context schema files, and every file is reviewed and may be
// hand-edited before commit (`-- reviewed` header). Hand-written SQL (extensions, triggers,
// policies, grants) is a custom migration: `pnpm --filter api exec drizzle-kit generate --custom
// --name=<slug>`. Migrations are applied by `pnpm --filter api migrate` only, never by drizzle-kit.
// New files are timestamp-named (`YYYYMMDDHHmmss_<slug>.sql`, CHORE-3) so parallel orders never
// collide on a name; 0000 to 0015 keep their index names; the runner applies in journal order.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/*/schema/*.ts',
  out: './drizzle',
  migrations: { prefix: 'timestamp' },
});
