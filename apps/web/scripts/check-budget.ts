// First-load JavaScript budget (WEB-1 plan 2.10; web §10.2, lead ruling on WEB-1 §8.2 #28): after
// `next build`, sums the gzip size of the chunks each route loads first and fails when the route's
// JavaScript above the shared framework chunk exceeds its class budget, or when the framework chunk
// itself exceeds its cap. apps/web and apps/admin both run it from their census lane:
//   node apps/web/scripts/check-budget.ts apps/web     (or apps/admin; default: the current dir)
//
// Source: Next 16 with Turbopack writes no app-build-manifest.json; it writes
// .next/diagnostics/route-bundle-stats.json (route → first-load chunk paths), and
// app-path-routes-manifest.json maps each route to its route group, which decides the class.
// The framework floor is build-manifest.json `rootMainFiles`: React, React DOM and the Next
// runtime, loaded by every App Router page.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/** Cap of the shared framework chunk (web §10.2), gzip. */
export const floorCapKb = 135;

/** Route group → budget of the JavaScript above the floor (web §10.2), gzip. */
export const budgetKbOfGroup: Record<string, number> = {
  recipient: 90,
  merchant: 180,
  platform: 180,
  // Sign-in doors carry the staff shell of their app, so they get the staff pages' budget.
  auth: 180,
};

export type BuildFacts = {
  stats: { route: string; firstLoadChunkPaths: string[] }[];
  appPaths: Record<string, string>;
  /** `.next/`-relative chunk paths of the framework floor. */
  floorChunks: string[];
  /** Gzip size in bytes of a chunk path as written in `stats`. */
  gzipSize: (chunk: string) => number;
};

export type RouteResult = {
  route: string;
  group: string;
  budgetKb: number;
  totalBytes: number;
  aboveFloorBytes: number;
  ok: boolean;
};

export type BudgetReport = { floorBytes: number; floorOk: boolean; routes: RouteResult[] };

/** `/(recipient)/track/[token]/page` → `recipient`; Next's own routes (`/_not-found`) → null. */
function groupOf(route: string, appPaths: Record<string, string>): string | null {
  if (route.startsWith('/_')) return null;
  const entry = Object.entries(appPaths).find(([, url]) => url === route)?.[0];
  const group = entry ? /^\/\(([^)]+)\)/.exec(entry)?.[1] : undefined;
  if (!group) throw new Error(`route ${route} is not in a route group (web §1.2)`);
  return group;
}

/** Measures every route against its class budget and the floor against its cap. */
export function checkBudget({ stats, appPaths, floorChunks, gzipSize }: BuildFacts): BudgetReport {
  const floor = new Set(floorChunks.map((file) => `.next/${file}`));
  const floorBytes = [...floor].reduce((sum, chunk) => sum + gzipSize(chunk), 0);
  const routes: RouteResult[] = [];
  for (const { route, firstLoadChunkPaths } of stats) {
    const group = groupOf(route, appPaths);
    if (group === null) continue;
    const budgetKb = budgetKbOfGroup[group];
    if (budgetKb === undefined) throw new Error(`route group (${group}) of ${route} has no budget`);
    const totalBytes = firstLoadChunkPaths.reduce((sum, chunk) => sum + gzipSize(chunk), 0);
    const aboveFloorBytes = firstLoadChunkPaths
      .filter((chunk) => !floor.has(chunk))
      .reduce((sum, chunk) => sum + gzipSize(chunk), 0);
    routes.push({
      route,
      group,
      budgetKb,
      totalBytes,
      aboveFloorBytes,
      ok: aboveFloorBytes <= budgetKb * 1024,
    });
  }
  return { floorBytes, floorOk: floorBytes <= floorCapKb * 1024, routes };
}

/** Reads the facts of a built app from its `.next` directory. */
export function readBuild(appDir: string): BuildFacts {
  const readJson = <T>(file: string): T => {
    try {
      return JSON.parse(readFileSync(path.join(appDir, '.next', file), 'utf8')) as T;
    } catch (error) {
      throw new Error(`cannot read .next/${file} in ${appDir}; run \`next build\` first`, {
        cause: error,
      });
    }
  };
  const sizes = new Map<string, number>();
  return {
    stats: readJson('diagnostics/route-bundle-stats.json'),
    appPaths: readJson('app-path-routes-manifest.json'),
    floorChunks: readJson<{ rootMainFiles: string[] }>('build-manifest.json').rootMainFiles,
    gzipSize(chunk) {
      let size = sizes.get(chunk);
      if (size === undefined) {
        size = gzipSync(readFileSync(path.join(appDir, chunk)), { level: 9 }).length;
        sizes.set(chunk, size);
      }
      return size;
    },
  };
}

const kb = (bytes: number) => (bytes / 1024).toFixed(1);

/** Prints the report; returns the number of failures (routes over budget, plus the floor). */
export function printReport(report: BudgetReport): number {
  console.log('First-load JavaScript, gzip');
  console.log(
    `  ${report.floorOk ? 'ok  ' : 'OVER'} framework floor (rootMainFiles): ` +
      `${kb(report.floorBytes)} KB of ${floorCapKb} KB`,
  );
  for (const r of report.routes) {
    console.log(
      `  ${r.ok ? 'ok  ' : 'OVER'} ${r.route} (${r.group}): ${kb(r.aboveFloorBytes)} KB above ` +
        `the floor, budget ${r.budgetKb} KB [total ${kb(r.totalBytes)} KB]`,
    );
  }
  const failures = report.routes.filter((r) => !r.ok).length + (report.floorOk ? 0 : 1);
  if (failures > 0) console.error(`${failures} first-load budget failure(s) (web §10.2)`);
  return failures;
}

if (import.meta.main) {
  const report = checkBudget(readBuild(path.resolve(process.argv[2] ?? '.')));
  if (printReport(report) > 0) process.exit(1);
}
