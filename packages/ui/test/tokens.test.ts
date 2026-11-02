import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { statusStates } from '../src/status';

// Web §6.2: tokens meet WCAG 2.2 AA. Text pairs need 4.5:1 (1.4.3); control boundaries and focus
// indicators need 3:1 (1.4.11). Ratios are computed from src/tokens.css itself.
const css = readFileSync(join(import.meta.dirname, '../src/tokens.css'), 'utf8');

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (!match?.[1]) throw new Error(`token --${name} is not a #rrggbb colour in tokens.css`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const surfaces = ['color-background', 'color-surface', 'color-muted'];

const textPairs: [string, string][] = [
  ...surfaces.flatMap((bg) => [
    ['color-foreground', bg] as [string, string],
    ['color-muted-foreground', bg] as [string, string],
    ['color-primary', bg] as [string, string],
    ['color-danger', bg] as [string, string],
  ]),
  ['color-primary-foreground', 'color-primary'],
  ['color-primary-foreground', 'color-primary-hover'],
  ['color-danger-foreground', 'color-danger'],
  ['color-warning-foreground', 'color-warning'],
  ['color-success-foreground', 'color-success'],
  ['color-support-foreground', 'color-support'],
  ['color-support', 'color-background'],
];

const boundaryPairs: [string, string][] = surfaces.flatMap((bg) => [
  ['color-input', bg] as [string, string],
  ['color-ring', bg] as [string, string],
]);

const statusTokens = Object.entries(statusStates).flatMap(([machine, list]) =>
  list.map((state) => `status-${machine}-${state}`),
);

describe('tokens.css', () => {
  it('checks the known contrast and that the parser reads the file', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(statusTokens).toHaveLength(24);
  });

  it.each(textPairs)('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(boundaryPairs)('boundary %s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(3);
  });

  it.each(statusTokens)('--%s exists and is readable as text on every surface', (name) => {
    for (const bg of surfaces) {
      expect(contrast(token(name), token(bg)), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('declares separate Arabic and Latin line heights, Arabic one step taller', () => {
    for (const step of ['tight', 'normal', 'relaxed']) {
      const ar = Number(new RegExp(`--leading-ar-${step}:\\s*([\\d.]+)`).exec(css)?.[1]);
      const en = Number(new RegExp(`--leading-en-${step}:\\s*([\\d.]+)`).exec(css)?.[1]);
      expect(ar, step).toBeGreaterThan(en);
    }
  });
});
