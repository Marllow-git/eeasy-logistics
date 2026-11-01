import type { MessagingStore } from '../platform/messaging.repository.js';
import type { OptOutSource } from '../schema/messaging.js';
import { normalisePhone } from './phone.js';

// The opt-out list (integrations §5.5; PLAT-9 plan 2.7, 2A.5; ADR-0041): an (account, phone) pair
// on it gets no recipient template from that account (`done`, reason `opted_out`); OTP never asks.
// A reply carrying a stop word adds the pair, a start word removes it; the engine's
// `suppression.changed` callback does the same with source `provider`. The word set is the union
// of ours and the engine's. Inbound replies arrive with a later order; `classifyReply` is ready for
// it, and tests add entries directly.

/** Stop and start words, compared after `normaliseWord` (ADR-0041: the union with the engine's). */
export const stopWords: readonly string[] = ['STOP', 'إيقاف', 'الغاء'];
export const startWords: readonly string[] = ['START', 'اشتراك', 'تشغيل'];

/**
 * Case-insensitive on a trimmed, whitespace-collapsed token; Arabic alef forms (أ إ آ) count as
 * the bare alef, so `إلغاء` and `الغاء` are one word, as people type both.
 */
export function normaliseWord(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/[أإآ]/g, 'ا').toLowerCase();
}

const stops = new Set(stopWords.map(normaliseWord));
const starts = new Set(startWords.map(normaliseWord));

/** `stop`, `start`, or null for any other reply (which is never stored). */
export function classifyReply(text: string): 'stop' | 'start' | null {
  const word = normaliseWord(text);
  if (stops.has(word)) return 'stop';
  if (starts.has(word)) return 'start';
  return null;
}

export class OptOutList {
  constructor(private readonly store: MessagingStore) {}

  /** Adds the pair; a phone that is not a valid number is ignored (false). */
  async add(accountId: string, phone: string, source: OptOutSource): Promise<boolean> {
    const e164 = normalisePhone(phone);
    if (e164 === undefined) return false;
    await this.store.run((repo) => repo.addOptOut(accountId, e164, source));
    return true;
  }

  async remove(accountId: string, phone: string): Promise<boolean> {
    const e164 = normalisePhone(phone);
    if (e164 === undefined) return false;
    await this.store.run((repo) => repo.removeOptOut(accountId, e164));
    return true;
  }

  async has(accountId: string, phone: string): Promise<boolean> {
    const e164 = normalisePhone(phone);
    if (e164 === undefined) return false;
    return this.store.run((repo) => repo.isOptedOut(accountId, e164));
  }

  /** A recipient's reply: a stop word adds the pair, a start word removes it, anything else nothing. */
  async fromReply(
    accountId: string,
    phone: string,
    text: string,
  ): Promise<'stop' | 'start' | null> {
    const kind = classifyReply(text);
    if (kind === 'stop') await this.add(accountId, phone, 'reply');
    if (kind === 'start') await this.remove(accountId, phone);
    return kind;
  }
}
