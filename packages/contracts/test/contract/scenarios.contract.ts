// Runs every scenario under test/scenarios against the running API (PLAT-15 plan 2.8); the runner
// script prints the coverage table from the results (advisory). Started by `pnpm --filter contracts test:contract`, which provides
// `apiUrl`; not part of the unit `test` run (the file name does not end in `.test.ts`).
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import type { SurfaceName } from '../../scripts/paths.ts';
import { packageRoot, surfaces } from '../../scripts/paths.ts';
import { ApiError, createFetcher } from '../../src/http.ts';
import { ContractValidator, recordingFetch } from './harness.ts';
import type { Scenario } from './scenario.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    apiUrl: string;
  }
}

const apiUrl = inject('apiUrl');
const scenariosDir = join(packageRoot, 'test', 'scenarios');

function scenarioFiles(surface: SurfaceName): string[] {
  const dir = join(scenariosDir, surface);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .sort()
    .map((file) => join(dir, file));
}

describe('the API under test', () => {
  it(`answers GET /health at ${apiUrl}`, async () => {
    const response = await fetch(new URL('/health', apiUrl));
    expect(response.status).toBe(200);
  });
});

for (const { name: surface } of surfaces) {
  const files = scenarioFiles(surface);
  if (files.length === 0) continue;
  const validator = ContractValidator.load(surface);
  // `X-EL-Client: web` belongs to the browser surfaces (README §1); the driver app and API-key
  // customers do not send it.
  const webClient = surface !== 'driver' && surface !== 'public';

  // The runner reads the suite name `<surface> scenarios` and the test name `<operationId>`.
  describe(`${surface} scenarios`, () => {
    for (const file of files) {
      const operationId = basename(file, '.ts');
      it(operationId, async () => {
        expect(validator.has(operationId), `${operationId} is not a ${surface} operation`).toBe(
          true,
        );
        const scenario = ((await import(file)) as { default: Scenario }).default;
        const recorder = recordingFetch();
        const fetcher = createFetcher({ baseUrl: apiUrl, fetch: recorder.fetch, webClient });
        try {
          await scenario.run({ apiUrl, fetcher });
        } catch (thrown) {
          if (!(thrown instanceof ApiError)) throw thrown;
        }
        const exchanges = (await recorder.responses()).map((response) => ({
          response,
          operationId: validator.match(response.method, response.url),
        }));
        const own = exchanges.filter((exchange) => exchange.operationId === operationId);
        expect(own.length, `the scenario never called ${operationId}`).toBeGreaterThan(0);
        expect(own.at(-1)?.response.status).toBe(scenario.expectedStatus);
        // Every documented call the scenario made is checked, a sign-in included.
        const violations = exchanges.flatMap(({ response, operationId: id }) =>
          id === undefined
            ? []
            : validator.check(id, response).map((v) => ({ operationId: id, ...v })),
        );
        expect(violations).toEqual([]);
      });
    }
  });
}
