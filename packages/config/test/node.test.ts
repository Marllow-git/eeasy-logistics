import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readEnvironment } from '../src/node.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elx-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readEnvironment (.env only when APP_ENV=local, plan 2.7)', () => {
  it('reads .env when the file says local; the process environment wins', () => {
    writeFileSync(
      join(dir, '.env'),
      'APP_ENV=local\nPORT=4000\nREDIS_URL=redis://localhost:6379\n',
    );
    const env = readEnvironment({ PORT: '5000' }, dir);
    expect(env).toMatchObject({
      APP_ENV: 'local',
      PORT: '5000',
      REDIS_URL: 'redis://localhost:6379',
    });
  });

  it.each(['ci', 'staging', 'production'])('ignores .env when the process says %s', (appEnv) => {
    writeFileSync(join(dir, '.env'), 'APP_ENV=local\nREDIS_URL=redis://localhost:6379\n');
    expect(readEnvironment({ APP_ENV: appEnv }, dir)).toEqual({ APP_ENV: appEnv });
  });

  it('ignores .env that does not say local, so the missing APP_ENV still fails boot', () => {
    writeFileSync(join(dir, '.env'), 'APP_ENV=production\nREDIS_URL=redis://localhost:6379\n');
    expect(readEnvironment({}, dir)).toEqual({});
  });

  it('returns a copy of the process environment when there is no .env', () => {
    const processEnv = { APP_ENV: 'ci' };
    const env = readEnvironment(processEnv, dir);
    expect(env).toEqual(processEnv);
    expect(env).not.toBe(processEnv);
  });
});

describe('loadConfig at process start (plan 2.5)', () => {
  const entry = fileURLToPath(new URL('../src/node.ts', import.meta.url));

  function boot(env: Record<string, string>) {
    const script = `import { loadConfig } from ${JSON.stringify(entry)};\nloadConfig();\nprocess.stdout.write('booted');\n`;
    const file = join(dir, 'boot.mjs');
    writeFileSync(file, script);
    // A clean environment and a working directory with no .env.
    return spawnSync(process.execPath, [file], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
    });
  }

  it('exits 78 naming the missing variable', () => {
    const result = boot({});
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('APP_ENV: is required');
    expect(result.stdout).toBe('');
  });

  it('exits 78 naming a malformed secret without printing it', () => {
    const fakeSecret = 'fake-too-short';
    const result = boot({
      APP_ENV: 'local',
      AUTH_SIGNING_KEY_ID: 'k1',
      AUTH_SIGNING_KEY: fakeSecret,
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('AUTH_SIGNING_KEY: is invalid');
    expect(result.stderr).not.toContain(fakeSecret);
  });

  it('boots with a valid environment', () => {
    const result = boot({ APP_ENV: 'ci' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('booted');
  });
});
