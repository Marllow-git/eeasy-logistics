import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actionKey, auditValue, changedFields } from './audit-values.ts';

// The console audit disclosure (WEB-4 plan 2.7, 2.11).

const format = {
  number: (value: number) => `#${value}`,
  boolean: (value: boolean) => (value ? 'yes' : 'no'),
  none: '—',
  separator: ', ',
};

void describe('changedFields', () => {
  void it('keeps the keys that changed, in first-seen order', () => {
    assert.deepEqual(
      changedFields({ status: 'active', name: 'A' }, { status: 'suspended', name: 'A' }),
      [{ key: 'status', before: 'active', after: 'suspended' }],
    );
    assert.deepEqual(changedFields(null, { enabled: true }), [
      { key: 'enabled', before: undefined, after: true },
    ]);
  });
});

void describe('auditValue and actionKey', () => {
  void it('prints scalars, lists and records for a person', () => {
    assert.equal(auditValue(undefined, format), '—');
    assert.equal(auditValue(false, format), 'no');
    assert.equal(auditValue(3, format), '#3');
    assert.equal(auditValue(['platform_admin'], format), 'platform_admin');
    assert.equal(auditValue([], format), '—');
    assert.equal(auditValue({ a: 1 }, format), '{"a":1}');
  });

  void it('turns an action into its catalogue key', () => {
    assert.equal(actionKey('platform.cross_tenant.accessed'), 'platform_cross_tenant_accessed');
    assert.equal(actionKey(undefined), '');
  });
});
