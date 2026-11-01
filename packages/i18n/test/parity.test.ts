import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { locales } from '../src/index';

// Locale parity (handbook 04, ADR-0016): every namespace file exists in every locale, and every
// key in one locale exists in all the others with a non-empty string value. Two catalogue roots:
// the shared one here and apps/admin/messages, the `platform` namespace only the admin app loads
// (ADR-0038). An app namespace must not shadow a shared one, since the admin request config merges
// both.
const shared = join(import.meta.dirname, '..');
const admin = join(import.meta.dirname, '../../../apps/admin/messages');
const roots = [
  { name: 'packages/i18n', root: shared },
  { name: 'apps/admin/messages', root: admin },
];

function namespacesIn(root: string, locale: string): string[] {
  return readdirSync(join(root, locale))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length));
}

function leafKeys(node: unknown, prefix = ''): Map<string, unknown> {
  const keys = new Map<string, unknown>();
  if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      for (const [leaf, leafValue] of leafKeys(value, prefix ? `${prefix}.${key}` : key)) {
        keys.set(leaf, leafValue);
      }
    }
  } else {
    keys.set(prefix, node);
  }
  return keys;
}

function load(root: string, locale: string, namespace: string): Map<string, unknown> {
  const raw = readFileSync(join(root, locale, `${namespace}.json`), 'utf8');
  return leafKeys(JSON.parse(raw));
}

describe.each(roots)('locale parity in $name', ({ root }) => {
  const namespacesOf = (locale: string) => namespacesIn(root, locale);
  const namespaces = [...new Set(locales.flatMap(namespacesOf))].sort();

  it('finds at least one namespace', () => {
    expect(namespaces.length).toBeGreaterThan(0);
  });

  it.each(namespaces)('namespace "%s" exists in every locale', (namespace) => {
    for (const locale of locales) {
      expect(namespacesOf(locale), `${locale}/${namespace}.json`).toContain(namespace);
    }
  });

  it.each(namespaces)('namespace "%s" has the same keys in every locale', (namespace) => {
    const keysByLocale = locales.map((locale) => [locale, load(root, locale, namespace)] as const);
    const allKeys = [...new Set(keysByLocale.flatMap(([, keys]) => [...keys.keys()]))].sort();
    for (const [locale, keys] of keysByLocale) {
      const missing = allKeys.filter((key) => !keys.has(key));
      expect(missing, `keys missing from ${locale}/${namespace}.json`).toEqual([]);
    }
  });

  it.each(namespaces)('namespace "%s" has a non-empty string for every key', (namespace) => {
    for (const locale of locales) {
      for (const [key, value] of load(root, locale, namespace)) {
        expect(
          typeof value === 'string' && value.trim() !== '',
          `${locale}/${namespace}.json ${key}`,
        ).toBe(true);
      }
    }
  });
});

describe('catalogue placement (ADR-0038)', () => {
  it('keeps the platform namespace in apps/admin only', () => {
    for (const locale of locales) {
      expect(namespacesIn(shared, locale)).not.toContain('platform');
      expect(namespacesIn(admin, locale)).toEqual(['platform']);
    }
  });
});
