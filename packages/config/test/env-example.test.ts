import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { describe, expect, it } from 'vitest';
import { defineConfig, serverVariables } from '../src/index.ts';
import { driverPublicVariables, webPublicVariables } from '../src/public.ts';

// .env.example at the repository root documents every variable (plan item F).
const text = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
const example = dotenv.parse(text);

// Read by compose.yaml, tools/native-stack.sh, tools/stack.sh and the compose-smoke workflow
// (PLAT-2), not by the API; the same file serves both.
const stackVariables = [
  'POSTGRES_PASSWORD',
  'ELX_OWNER_PASSWORD',
  'ELX_APP_PASSWORD',
  'ELX_PLATFORM_PASSWORD',
  'ELX_MAINTENANCE_PASSWORD',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
  'MINIO_BUCKET',
  'OSRM_HOST',
  'OSRM_PORT',
];

describe('.env.example', () => {
  const declared = [
    ...Object.keys(serverVariables),
    ...Object.keys(webPublicVariables),
    ...Object.keys(driverPublicVariables),
  ];

  it('lists every variable the package reads, each under a comment', () => {
    const lines = text.split('\n');
    for (const variable of declared) {
      const index = lines.findIndex((line) => line.startsWith(`${variable}=`));
      expect(index, `${variable} is missing`).toBeGreaterThan(0);
      expect(lines[index - 1], `${variable} has no comment`).toMatch(/^# /);
    }
  });

  it('lists nothing the package does not read, except the service stack variables', () => {
    const undeclared = Object.keys(example).filter((name) => !declared.includes(name));
    expect(undeclared).toEqual(stackVariables);
  });

  it('comments every service stack variable too', () => {
    const lines = text.split('\n');
    for (const variable of stackVariables) {
      const index = lines.findIndex((line) => line.startsWith(`${variable}=`));
      expect(lines[index - 1], `${variable} has no comment`).toMatch(/^# /);
    }
  });

  it('points the API at the stack credentials in the same file', () => {
    for (const role of ['owner', 'app', 'platform', 'maintenance']) {
      const url = new URL(example[`DATABASE_URL_${role.toUpperCase()}`] ?? '');
      expect(url.username).toBe(`elx_${role}`);
      expect(url.password).toBe(example[`ELX_${role.toUpperCase()}_PASSWORD`]);
    }
    expect(example.STORAGE_ACCESS_KEY_ID).toBe(example.MINIO_ROOT_USER);
    expect(example.STORAGE_SECRET_ACCESS_KEY).toBe(example.MINIO_ROOT_PASSWORD);
    expect(example.STORAGE_BUCKET).toBe(example.MINIO_BUCKET);
  });

  it('is a valid local configuration as copied', () => {
    expect(defineConfig(example).app.env).toBe('local');
  });
});
