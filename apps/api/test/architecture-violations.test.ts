import { spawnSync } from 'node:child_process';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// PLAT-6 item I (handbook 03, doc 3 §9 "Enforcement"): the A-17 dependency-cruiser rules ship with
// violation fixtures, one per rule, under test/architecture/violations/. `test:architecture`
// cruises src/ and the permitted fixtures only; this test cruises the violations and asserts that
// each one is reported by its rule, so deleting or loosening a rule turns it red.

interface Violation {
  readonly from: string;
  readonly rule: { readonly name: string };
}

function cruiseViolations(): Violation[] {
  const run = spawnSync(
    'node_modules/.bin/depcruise',
    [
      'test/architecture/violations',
      '--config',
      '.dependency-cruiser.cjs',
      '--output-type',
      'json',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const result = JSON.parse(run.stdout) as { summary: { violations: Violation[] } };
  return result.summary.violations;
}

describe('A-17 architecture rules fail on their violation fixtures', () => {
  const violations = cruiseViolations();
  const rulesOf = (file: string) =>
    violations
      .filter((violation) => violation.from === `test/architecture/violations/modules/${file}`)
      .map((violation) => violation.rule.name);

  it('refuses a *.dto.ts file (no-dto-files)', () => {
    expect(rulesOf('delivery/create-order.dto.ts')).toContain('no-dto-files');
  });

  it('refuses a -dto.ts file and anything under dto/ (no-dto-files, adversary L-8)', () => {
    expect(rulesOf('delivery/cancel-order-dto.ts')).toContain('no-dto-files');
    expect(rulesOf('delivery/dto/assign-driver.ts')).toContain('no-dto-files');
  });

  it('refuses class-validator and its kind (no-validation-libraries)', () => {
    expect(rulesOf('delivery/validated-input.ts')).toContain('no-validation-libraries');
  });

  it('refuses a contracts import outside controllers and presenters', () => {
    expect(rulesOf('delivery/orders.service.ts')).toEqual([
      'contracts-only-in-controllers-and-presenters',
    ]);
  });

  it('refuses a committed side effect outside the kernel audit folder (PLAT-7 plan 2.4)', () => {
    expect(rulesOf('delivery/committed-side-effect.ts')).toEqual([
      'committed-side-effects-only-in-audit',
    ]);
  });

  it('refuses the owner migration entry outside the owner jobs (PLAT-7 plan 2.8)', () => {
    expect(rulesOf('delivery/migrate-runner.ts')).toEqual(['db-migrate-only-in-owner-jobs']);
  });

  it('refuses the migration job reaching the application or the contracts (PLAT-7 CI fix)', () => {
    const rules = violations
      .filter((violation) => violation.from === 'test/architecture/violations/migrate/loads-app.ts')
      .map((violation) => violation.rule.name);
    expect(rules).toContain('migrate-job-loads-no-application');
  });

  it('refuses a barrel surface entry from a controller (contracts-server-entries-only)', () => {
    expect(rulesOf('kernel-barrel.controller.ts')).toEqual(['contracts-server-entries-only']);
  });
});

describe('A-17 ESLint rules fail on their violation fixtures (adversary M-6)', () => {
  // The rules need no type information: one ESLint instance with the app's own config, the
  // TypeScript program off and only the three rules under test, lints every fixture in one run
  // (well under a second; CI timed out at 5 s with the type-aware program). `ignore: false` lints
  // the fixtures, which `eslint .` skips.
  const fixtures = 'test/architecture/violations/lint';
  const rules = new Set([
    'no-restricted-syntax',
    'no-restricted-imports',
    'elx/disable-needs-reason',
  ]);
  let findings: Promise<Map<string, string[]>> | undefined;
  const lint = (): Promise<Map<string, string[]>> => {
    findings ??= new ESLint({
      ignore: false,
      overrideConfig: {
        languageOptions: { parserOptions: { projectService: false, project: null } },
      },
      ruleFilter: ({ ruleId }) => rules.has(ruleId),
    })
      .lintFiles([`${fixtures}/*.ts`])
      .then(
        (results) =>
          new Map(
            results.map((result) => [
              result.filePath.slice(result.filePath.indexOf(fixtures) + fixtures.length + 1),
              result.messages.map((message) => message.ruleId ?? 'fatal'),
            ]),
          ),
      );
    return findings;
  };
  const rulesOf = async (file: string) => (await lint()).get(file) ?? [];
  const count = (found: string[], rule: string) => found.filter((id) => id === rule).length;

  it('reports each raw parameter decorator in a controller', { timeout: 30_000 }, async () => {
    const found = await rulesOf('raw-input.controller.ts');
    expect(count(found, 'no-restricted-syntax')).toBe(6);
    expect(count(found, 'no-restricted-imports')).toBe(6);
  });

  it('reports an aliased import (re-check M-6)', { timeout: 30_000 }, async () => {
    expect(await rulesOf('alias-import.controller.ts')).toEqual(['no-restricted-imports']);
  });

  it(
    'reports a namespace import and the decorator used through it',
    { timeout: 30_000 },
    async () => {
      const found = await rulesOf('namespace-import.controller.ts');
      expect(count(found, 'no-restricted-imports')).toBe(1);
      expect(count(found, 'no-restricted-syntax')).toBe(1);
    },
  );

  it('reports @Ip() and its import', { timeout: 30_000 }, async () => {
    const found = await rulesOf('ip.controller.ts');
    expect(count(found, 'no-restricted-imports')).toBe(1);
    expect(count(found, 'no-restricted-syntax')).toBe(1);
  });

  it(
    'reports an operation built in the controller instead of the generated entry (PLAT-10)',
    { timeout: 30_000 },
    async () => {
      expect(await rulesOf('forged-operation.controller.ts')).toEqual([
        'no-restricted-syntax',
        'no-restricted-syntax',
        'no-restricted-syntax',
      ]);
    },
  );

  it('reports @Controller() outside a *.controller.ts file', { timeout: 30_000 }, async () => {
    expect(await rulesOf('orders.service.ts')).toEqual(['no-restricted-syntax']);
  });

  it(
    'reports the owner URL read outside the owner jobs (PLAT-7)',
    { timeout: 30_000 },
    async () => {
      expect(await rulesOf('owner-url.ts')).toEqual([
        'no-restricted-syntax',
        'no-restricted-syntax',
        'no-restricted-syntax',
      ]);
    },
  );

  it('reports a disable comment without a reason', { timeout: 30_000 }, async () => {
    expect(await rulesOf('unexplained-disable.ts')).toEqual(['elx/disable-needs-reason']);
  });
});
