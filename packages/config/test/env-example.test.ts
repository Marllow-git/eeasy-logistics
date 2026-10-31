import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { describe, expect, it } from 'vitest';
import { defineConfig, serverVariables } from '../src/index.ts';
import { driverPublicVariables, webPublicVariables } from '../src/public.ts';

// .env.example at the repository root documents every variable (plan item F).
const text = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
const example = dotenv.parse(text);

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

  it('lists nothing the package does not read', () => {
    expect(Object.keys(example).filter((name) => !declared.includes(name))).toEqual([]);
  });

  it('is a valid local configuration as copied', () => {
    expect(defineConfig(example).app.env).toBe('local');
  });
});
