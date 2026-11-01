// `pnpm --filter contracts test:contract [-- --api <origin>]` (PLAT-15 plan 2.8, 2.10): runs the
// harness self-test and every scenario under test/scenarios against the running API. The origin
// comes from `--api`, else from `CONTRACT_API_URL` through packages/config; never read directly.
import { parseArgs } from 'node:util';
import { contractTestConfig } from '@eeasy-logistics/config/contract-test';
import { createVitest } from 'vitest/node';
import { ContractValidator } from '../test/contract/harness.ts';
import { packageRoot, surfaces } from './paths.ts';

const { values } = parseArgs({
  // pnpm forwards a literal `--` before the script's own arguments.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { api: { type: 'string' } },
});

const apiUrl = values.api ?? contractTestConfig().apiUrl;
if (apiUrl === undefined) {
  console.error(
    'test:contract needs the API origin: pass --api http://127.0.0.1:3000 or set CONTRACT_API_URL.',
  );
  process.exit(2);
}
try {
  new URL(apiUrl);
} catch {
  console.error('--api must be an absolute http(s) URL.');
  process.exit(2);
}

const vitest = await createVitest({
  root: packageRoot,
  config: false,
  watch: false,
  include: ['test/contract/self-test.test.ts', 'test/contract/scenarios.contract.ts'],
  provide: { apiUrl },
});
try {
  // Sets process.exitCode to 1 when a test fails.
  await vitest.start();
  printCoverage();
} finally {
  await vitest.close();
}

/** Operations with and without a passing scenario, per surface (advisory, plan 2.8). */
function printCoverage(): void {
  const passed = new Set<string>();
  for (const module of vitest.state.getTestModules()) {
    for (const test of module.children.allTests()) {
      const suite = test.parent.type === 'suite' ? test.parent.name : '';
      const surface = /^(\w+) scenarios$/.exec(suite)?.[1];
      if (surface !== undefined && test.result().state === 'passed') {
        passed.add(`${surface}/${test.name}`);
      }
    }
  }
  const lines = [
    '',
    'Contract coverage (advisory; an operation gains its scenario in the PR that implements it)',
    '',
    '| Surface | Operations | With a passing scenario | Without |',
    '|---|---|---|---|',
  ];
  const missing: string[] = [];
  for (const { name } of surfaces) {
    const all = ContractValidator.load(name).operationIds();
    const without = all.filter((id) => !passed.has(`${name}/${id}`));
    lines.push(`| ${name} | ${all.length} | ${all.length - without.length} | ${without.length} |`);
    if (without.length > 0) missing.push(`${name} without a scenario: ${without.join(', ')}`);
  }
  console.log([...lines, '', ...missing, ''].join('\n'));
}
