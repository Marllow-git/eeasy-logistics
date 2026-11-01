import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { checkBudget, type BuildFacts } from './check-budget.ts';

// The budget measure (web §10.2, lead ruling on WEB-1 §8.2 #28) against a fixture of Next's route
// bundle stats: route JavaScript above the shared framework chunk per class, the chunk itself capped.
// node:test returns promises the runner awaits; `void` marks them for no-floating-promises.

const stats = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures/route-bundle-stats.json'), 'utf8'),
) as BuildFacts['stats'];

// `/about` sits outside any route group: the default budget with a warning, not an error.
const appPaths = {
  '/(merchant)/page': '/',
  '/(recipient)/track/[token]/page': '/track/[token]',
  '/about/page': '/about',
  '/_not-found/page': '/_not-found',
};

const KB = 1024;

function facts(sizesKb: { framework: number; merchant: number; recipient: number }): BuildFacts {
  return {
    stats,
    appPaths,
    floorChunks: ['static/chunks/framework.js'],
    gzipSize: (chunk) => {
      const name = path.basename(chunk, '.js') as keyof typeof sizesKb;
      return sizesKb[name] * KB;
    },
  };
}

void describe('checkBudget', () => {
  void it('passes routes under their class budget above the floor and a floor under its cap', () => {
    const report = checkBudget(facts({ framework: 130, merchant: 170, recipient: 85 }));
    assert.equal(report.floorOk, true);
    assert.equal(report.floorBytes, 130 * KB);
    assert.deepEqual(
      report.routes.map((r) => [r.route, r.group, r.budgetKb, r.ok]),
      [
        ['/', 'merchant', 180, true],
        ['/track/[token]', 'recipient', 90, true],
        ['/about', null, 180, true],
      ],
    );
    const track = report.routes[1]!;
    assert.equal(track.aboveFloorBytes, 85 * KB);
    assert.equal(track.totalBytes, 215 * KB);
  });

  void it('fails a route over its class budget above the floor', () => {
    const report = checkBudget(facts({ framework: 130, merchant: 181, recipient: 91 }));
    assert.deepEqual(
      report.routes.map((r) => r.ok),
      [false, false, false],
    );
    assert.equal(report.floorOk, true);
  });

  void it('fails a framework chunk over its cap', () => {
    const report = checkBudget(facts({ framework: 136, merchant: 10, recipient: 10 }));
    assert.equal(report.floorOk, false);
    assert.ok(report.routes.every((r) => r.ok));
  });

  void it('checks a route outside any route group against the default budget, with a warning', () => {
    const report = checkBudget(facts({ framework: 130, merchant: 170, recipient: 85 }));
    const about = report.routes.find((r) => r.route === '/about');
    assert.deepEqual([about?.group, about?.budgetKb, about?.ok], [null, 180, true]);
    assert.deepEqual(report.warnings, [
      '/about is outside any route group (web §1.2); checked against 180 KB',
    ]);
  });

  void it('refuses a route group without a budget', () => {
    assert.throws(
      () =>
        checkBudget({
          ...facts({ framework: 1, merchant: 1, recipient: 1 }),
          appPaths: { '/(new)/page': '/' },
        }),
      /route group \(new\) of \/ has no budget/,
    );
  });
});
