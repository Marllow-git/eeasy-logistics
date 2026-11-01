import { spawnSync } from 'node:child_process';
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

  it('refuses class-validator and its kind (no-validation-libraries)', () => {
    expect(rulesOf('delivery/validated-input.ts')).toContain('no-validation-libraries');
  });

  it('refuses a contracts import outside controllers and presenters', () => {
    expect(rulesOf('delivery/orders.service.ts')).toEqual([
      'contracts-only-in-controllers-and-presenters',
    ]);
  });
});
