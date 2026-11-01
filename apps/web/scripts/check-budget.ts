// First-load JavaScript budget (WEB-1 plan 2.10; web §10.2): after `next build`, sums the gzip size
// of the chunks each route loads first and fails when a route exceeds the budget of its class.
// apps/web and apps/admin both run it from their census lane:
//   node apps/web/scripts/check-budget.ts apps/web     (or apps/admin; default: the current dir)
//
// Source: Next 16 with Turbopack writes no app-build-manifest.json; it writes
// .next/diagnostics/route-bundle-stats.json (route → first-load chunk paths), and
// app-path-routes-manifest.json maps each route to its route group, which decides the class.
// The framework floor is build-manifest.json `rootMainFiles`: React, React DOM and the Next
// runtime, loaded by every App Router page.
//
// Measures (WEB-1 §8.2 #27, provisional until the lead rules): merchant, platform and auth routes
// count their whole first load (web §10.2's definition). Recipient routes count the JavaScript
// above the framework floor, because the floor alone (about 128 KB gzip with Next 16.4 and
// React 19.3) is over the 90 KB the document sets; their total is printed beside it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

type Measure = 'total' | 'above-floor';
type RouteClass = { name: string; budgetKb: number; measure: Measure };

const merchant: RouteClass = { name: 'merchant', budgetKb: 180, measure: 'total' };
const platform: RouteClass = { name: 'platform', budgetKb: 180, measure: 'total' };
const recipient: RouteClass = { name: 'recipient', budgetKb: 90, measure: 'above-floor' };
// Sign-in doors carry the staff shell of their app, so they get the staff pages' budget.
const signIn: RouteClass = { name: 'sign-in', budgetKb: 180, measure: 'total' };

/** Route group → class (web §10.2). An unknown group fails, so a new group must be classified. */
const classOfGroup: Record<string, RouteClass> = {
  merchant,
  platform,
  recipient,
  auth: signIn,
};

const appDir = path.resolve(process.argv[2] ?? '.');
const nextDir = path.join(appDir, '.next');

function readJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(path.join(nextDir, file), 'utf8')) as T;
  } catch (error) {
    throw new Error(`cannot read .next/${file} in ${appDir}; run \`next build\` first`, {
      cause: error,
    });
  }
}

const stats = readJson<{ route: string; firstLoadChunkPaths: string[] }[]>(
  'diagnostics/route-bundle-stats.json',
);
const appPaths = readJson<Record<string, string>>('app-path-routes-manifest.json');
const floorChunks = new Set(
  readJson<{ rootMainFiles: string[] }>('build-manifest.json').rootMainFiles.map(
    (file) => `.next/${file}`,
  ),
);

const gzipBytes = new Map<string, number>();
function gzipSize(chunk: string): number {
  let size = gzipBytes.get(chunk);
  if (size === undefined) {
    size = gzipSync(readFileSync(path.join(appDir, chunk)), { level: 9 }).length;
    gzipBytes.set(chunk, size);
  }
  return size;
}

/** `/(recipient)/track/[token]/page` → `recipient`; Next's own routes (`/_not-found`) → null. */
function groupOf(route: string): string | null {
  if (route.startsWith('/_')) return null;
  const entry = Object.entries(appPaths).find(([, url]) => url === route)?.[0];
  const group = entry ? /^\/\(([^)]+)\)/.exec(entry)?.[1] : undefined;
  if (!group) throw new Error(`route ${route} is not in a route group (web §1.2)`);
  return group;
}

const kb = (bytes: number) => (bytes / 1024).toFixed(1);
const floorBytes = [...floorChunks].reduce((sum, chunk) => sum + gzipSize(chunk), 0);
let failures = 0;

console.log(`First-load JavaScript, gzip, ${path.relative(process.cwd(), appDir) || '.'}`);
console.log(`  framework floor (rootMainFiles): ${kb(floorBytes)} KB`);
for (const { route, firstLoadChunkPaths } of stats) {
  const group = groupOf(route);
  if (group === null) continue;
  const routeClass = classOfGroup[group];
  if (!routeClass) throw new Error(`route group (${group}) of ${route} has no budget class`);
  const total = firstLoadChunkPaths.reduce((sum, chunk) => sum + gzipSize(chunk), 0);
  const above = firstLoadChunkPaths
    .filter((chunk) => !floorChunks.has(chunk))
    .reduce((sum, chunk) => sum + gzipSize(chunk), 0);
  const measured = routeClass.measure === 'total' ? total : above;
  const ok = measured <= routeClass.budgetKb * 1024;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? 'ok  ' : 'OVER'} ${route} (${group}, ${routeClass.name} class): ` +
      `${kb(measured)} KB ${routeClass.measure} of ${routeClass.budgetKb} KB ` +
      `[total ${kb(total)} KB, above floor ${kb(above)} KB]`,
  );
}

if (failures > 0) {
  console.error(`${failures} route(s) over the first-load budget (web §10.2)`);
  process.exit(1);
}
