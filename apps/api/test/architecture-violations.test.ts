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

  it('refuses a barrel surface entry from a controller (contracts-server-entries-only)', () => {
    expect(rulesOf('kernel-barrel.controller.ts')).toEqual(['contracts-server-entries-only']);
  });
});

describe('A-17 ESLint rule fails on its violation fixture (adversary M-6)', () => {
  // The rule needs no type information: the app's config runs with the TypeScript program off
  // and only `no-restricted-syntax`, so the lint takes well under a second (CI timed out at 5 s
  // with the type-aware program); the 30 s timeout covers a loaded runner.
  it('reports each raw parameter decorator in a controller', { timeout: 30_000 }, async () => {
    // `ignore: false` lints the fixture, which `eslint .` skips; the config is the app's own.
    const eslint = new ESLint({
      ignore: false,
      overrideConfig: {
        languageOptions: { parserOptions: { projectService: false, project: null } },
      },
      ruleFilter: ({ ruleId }) => ruleId === 'no-restricted-syntax',
    });
    const [result] = await eslint.lintFiles([
      'test/architecture/violations/lint/raw-input.controller.ts',
    ]);
    const raw = (result?.messages ?? []).filter(
      (message) =>
        message.ruleId === 'no-restricted-syntax' && message.message.includes('@Input()'),
    );
    expect(raw).toHaveLength(6);
  });
});
