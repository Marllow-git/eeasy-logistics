// Bundles each API surface into one file (document 3 §9, PLAT-15 plan 2.2):
// generated/openapi/<surface>.yaml and .json, with the ./components.yaml refs pulled in.
// The three staff files (ADR-0026) are joined first; their operationIds are unique (lint rule).
// Run: pnpm --filter contracts build:bundle
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { contractsDir, generatedDir, packageRoot, surfaces } from './paths.ts';

const redocly = join(packageRoot, 'node_modules/.bin/redocly');
const outDir = join(generatedDir, 'openapi');
const scratch = join(generatedDir, '.join');

/** Runs the Redocly CLI quietly; its output is shown only when it fails. */
function redoclyRun(args: string[]): void {
  try {
    execFileSync(redocly, args, { cwd: packageRoot, stdio: 'pipe' });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    console.error(`redocly ${args.join(' ')} failed:\n${String(stdout)}${String(stderr)}`);
    throw error;
  }
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(scratch, { recursive: true });

try {
  for (const surface of surfaces) {
    let root = join(contractsDir, 'openapi', `${surface.files[0]}.yaml`);
    if (surface.files.length > 1) {
      root = join(scratch, `${surface.name}.yaml`);
      redoclyRun([
        'join',
        ...surface.files.map((file) => join(contractsDir, 'openapi', `${file}.yaml`)),
        '--without-x-tag-groups',
        '-o',
        root,
      ]);
    }
    for (const ext of ['yaml', 'json']) {
      redoclyRun(['bundle', root, '--ext', ext, '-o', join(outDir, `${surface.name}.${ext}`)]);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
