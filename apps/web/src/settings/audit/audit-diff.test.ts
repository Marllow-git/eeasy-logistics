import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auditValue, changedFields, type AuditFormat } from './audit-diff.ts';

// The audit entry's before-and-after (WEB-3 plan 2.9): changed keys only, values for a person.
// node:test returns promises the runner awaits; `void` marks them for no-floating-promises.

const labels: Record<string, Record<string, string>> = {
  roles: { owner: 'Owner', viewer: 'Viewer' },
  kind: { branch: 'Branch' },
  fields: { delivery: 'Delivery' },
};

const format: AuditFormat = {
  number: (value) => String(value),
  dateTime: (iso) => `at ${iso.slice(0, 10)}`,
  boolean: (value) => (value ? 'Yes' : 'No'),
  enumLabel: (key, value) => labels[key]?.[value],
  weekday: (day) => ['Sun', 'Mon'][day] ?? String(day),
  none: '—',
  separator: ', ',
};

void describe('changedFields', () => {
  void it('keeps the keys whose value changed, in first-seen order, on either side', () => {
    assert.deepEqual(
      changedFields(
        { roles: ['viewer'], site_ids: [], email: 'a@b.test' },
        { roles: ['viewer', 'dispatcher'], site_ids: [], name: 'Huda' },
      ),
      [
        { key: 'roles', before: ['viewer'], after: ['viewer', 'dispatcher'] },
        { key: 'email', before: 'a@b.test', after: undefined },
        { key: 'name', before: undefined, after: 'Huda' },
      ],
    );
  });

  void it('treats a missing side as empty', () => {
    assert.deepEqual(changedFields(null, { kind: 'branch' }), [
      { key: 'kind', before: undefined, after: 'branch' },
    ]);
    assert.deepEqual(changedFields(undefined, undefined), []);
  });
});

void describe('auditValue', () => {
  void it('names enum values, joins lists and marks empty ones', () => {
    assert.equal(auditValue('roles', ['owner', 'viewer'], format), 'Owner, Viewer');
    assert.equal(auditValue('roles', ['unknown_role'], format), 'unknown_role');
    assert.equal(auditValue('site_ids', [], format), '—');
    assert.equal(auditValue('address_text', null, format), '—');
    assert.equal(auditValue('kind', 'branch', format), 'Branch');
  });

  void it('prints numbers, booleans and instants with the page formats', () => {
    assert.equal(auditValue('max_attempts', 5, format), '5');
    assert.equal(auditValue('second_factor_required', true, format), 'Yes');
    assert.equal(auditValue('expires_at', '2026-11-05T09:00:00.000Z', format), 'at 2026-11-05');
  });

  void it('prints a point, opening hours, reason codes and a nested object for a person', () => {
    assert.equal(auditValue('point', { lat: 24.69, lng: 46.68 }, format), '24.69, 46.68');
    assert.equal(
      auditValue('opening_hours', [{ weekday: 0, opens: '09:00', closes: '21:00' }], format),
      'Sun 09:00–21:00',
    );
    assert.equal(
      auditValue('reason_codes', [{ code: 'absent', label_ar: 'غائب', label_en: 'Away' }], format),
      'absent (غائب / Away)',
    );
    assert.equal(
      auditValue('proof_policy', { delivery: ['photo'], cod: [] }, format),
      'Delivery: photo; cod: —',
    );
  });
});
