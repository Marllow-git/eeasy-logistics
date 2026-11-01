// Orval generation per surface (PLAT-15 plan 2.3), from the bundles of scripts/bundle.ts.
// Per surface: a fetch client and its model types, Zod schemas, and for the web-facing surfaces
// TanStack Query hooks with MSW handlers. driver and recipient get no hooks and no MSW, so the
// driver app pulls in no browser-only code. Output lands in generated/<surface>/ (never committed).
import { defineConfig } from 'orval';
import type { Options } from 'orval';

type SurfaceName = 'staff' | 'platform' | 'driver' | 'recipient' | 'public';

const withHooks: Record<SurfaceName, boolean> = {
  staff: true,
  platform: true,
  public: true,
  driver: false,
  recipient: false,
};

const mutator = { path: './src/http.ts', name: 'apiFetch' };
// Paths carry the surface base path from `servers` (`/v1/staff/...`); the fetcher adds the origin.
const baseUrl = { getBaseUrlFromSpecification: true } as const;

function entries(surface: SurfaceName): Record<string, Options> {
  const input = { target: `./generated/openapi/${surface}.json` };
  const out = `./generated/${surface}`;
  const result: Record<string, Options> = {
    [`${surface}Client`]: {
      input,
      output: {
        mode: 'single',
        client: 'fetch',
        target: `${out}/client.ts`,
        schemas: `${out}/model`,
        baseUrl,
        override: { mutator },
      },
    },
    [`${surface}Zod`]: {
      input,
      output: {
        mode: 'single',
        client: 'zod',
        target: `${out}/schemas.ts`,
      },
    },
  };
  if (withHooks[surface]) {
    result[`${surface}Hooks`] = {
      input,
      output: {
        mode: 'split',
        client: 'react-query',
        httpClient: 'fetch',
        target: `${out}/hooks.ts`,
        schemas: `${out}/model`,
        baseUrl,
        mock: { generators: [{ type: 'msw' }] },
        override: { mutator },
      },
    };
  }
  return result;
}

export default defineConfig({
  ...entries('staff'),
  ...entries('platform'),
  ...entries('public'),
  ...entries('driver'),
  ...entries('recipient'),
});
