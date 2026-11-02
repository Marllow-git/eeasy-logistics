import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  accountOfPath,
  headerReason,
  headerReasonLength,
  keepOnly,
  readReason,
  supportHeaders,
  writeReason,
  type ReasonStorage,
} from './reason-store.ts';

// The tab's support reason (web §3.5; WEB-4 plan 2.4, §7 #4): one per account, removed when the
// tab leaves the account and on sign-out; the header form the API can receive.

class MemoryStorage implements ReasonStorage {
  readonly #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.#items.set(key, value);
  }
  removeItem(key: string) {
    this.#items.delete(key);
  }
}

const one = '01920000-0000-7aaa-8bbb-000000000001';
const two = '01920000-0000-7aaa-8bbb-000000000002';

void describe('the support reason store', () => {
  void it('holds a reason per account, never another account’s', () => {
    const storage = new MemoryStorage();
    writeReason(storage, one, 'Ticket 4411: driver cannot see orders');
    assert.equal(readReason(storage, one), 'Ticket 4411: driver cannot see orders');
    assert.equal(readReason(storage, two), undefined);
    assert.equal(readReason(storage, one.toUpperCase()), 'Ticket 4411: driver cannot see orders');
  });

  void it('keeps only the account the tab is on, and nothing once it leaves', () => {
    const storage = new MemoryStorage();
    storage.setItem('elx:table:accounts', 'kept');
    writeReason(storage, one, 'first reason');
    writeReason(storage, two, 'second reason');
    keepOnly(storage, two);
    assert.equal(readReason(storage, one), undefined);
    assert.equal(readReason(storage, two), 'second reason');
    keepOnly(storage, undefined);
    assert.equal(readReason(storage, two), undefined);
    assert.equal(storage.getItem('elx:table:accounts'), 'kept');
  });

  void it('reads the account of a console path', () => {
    assert.equal(accountOfPath(`/accounts/${one}`), one);
    assert.equal(accountOfPath(`/accounts/${one}/flags`), one);
    assert.equal(accountOfPath('/accounts/new'), undefined);
    assert.equal(accountOfPath('/accounts'), undefined);
    assert.equal(accountOfPath('/rollout'), undefined);
    assert.equal(accountOfPath(null), undefined);
  });
});

void describe('the support header', () => {
  void it('sends a Latin reason as it is and an Arabic one percent-encoded', () => {
    assert.equal(headerReason('Ticket 4411'), 'Ticket 4411');
    assert.equal(headerReason('بلاغ ٤٤'), encodeURIComponent('بلاغ ٤٤'));
    assert.equal(decodeURIComponent(headerReason('بلاغ رقم 4411')), 'بلاغ رقم 4411');
    assert.deepEqual(supportHeaders(undefined), {});
    assert.deepEqual(supportHeaders('Ticket 4411'), { 'X-Support-Reason': 'Ticket 4411' });
  });

  void it('measures what the API counts', () => {
    assert.equal(headerReasonLength('  Ticket  '), 6);
    assert.equal(headerReasonLength('بلاغ'), encodeURIComponent('بلاغ').length);
  });
});
