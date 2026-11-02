import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createdRange, definedParams, isUuid } from './list-dates.ts';

// The console lists' date and id filters (WEB-4 plan 2.8, 2.11).

void describe('createdRange', () => {
  void it('sends Riyadh midnight, the "to" day included whole', () => {
    assert.deepEqual(createdRange({ created_from: '2026-11-01', created_to: '2026-11-02' }), {
      created_from: '2026-10-31T21:00:00.000Z',
      created_to: '2026-11-02T21:00:00.000Z',
    });
  });

  void it('leaves a malformed or absent day out', () => {
    assert.deepEqual(createdRange({ created_from: '1/11/2026', created_to: undefined }), {});
  });
});

void describe('isUuid and definedParams', () => {
  void it('takes whole ids only and drops absent parameters', () => {
    assert.equal(isUuid('01920000-0000-7abc-8def-0123456789ab'), true);
    assert.equal(isUuid('01920000'), false);
    assert.equal(isUuid(undefined), false);
    assert.deepEqual(definedParams({ a: 'x', b: undefined }), { a: 'x' });
  });
});
