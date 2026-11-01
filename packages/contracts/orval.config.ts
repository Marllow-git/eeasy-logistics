// Orval generation per surface (PLAT-15 plan 2.3), from the bundles of scripts/bundle.ts.
// Per surface: a fetch client with its model and per-status response types, strict Zod schemas per
// operation (plan 2.12, A-17), MSW handlers and mock factories (test-only entry points), and for
// staff, platform and public TanStack Query hooks. driver and recipient get no hooks, so the driver
// app pulls in no browser-only code. Output lands in generated/<surface>/ (never committed).
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

// Plan 2.12: request schemas reject undeclared fields (K-3: no client adds `account_id`); path and
// query arrive as strings and are coerced to number and boolean; bodies are JSON and not coerced.
// Responses are not strict (the contract tests own undocumented fields) and get one schema per status.
type OutputOptions = Exclude<NonNullable<Options['output']>, string>;
type ZodOptions = NonNullable<NonNullable<OutputOptions['override']>['zod']>;
const zod: ZodOptions = {
  strict: { param: true, query: true, header: true, body: true, response: false },
  coerce: { param: ['number', 'boolean'], query: ['number', 'boolean'] },
  generate: { param: true, query: true, header: true, body: true, response: true },
  generateEachHttpStatus: true,
};
const mock: OutputOptions['mock'] = { generators: [{ type: 'msw' }] };

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
        override: { zod },
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
        mock,
        override: { mutator },
      },
    };
  } else {
    // Without hooks, the handlers come from a second fetch client that exists only for them.
    result[`${surface}Mocks`] = {
      input,
      output: {
        mode: 'split',
        client: 'fetch',
        target: `${out}/mocks/client.ts`,
        schemas: `${out}/model`,
        baseUrl,
        mock,
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
