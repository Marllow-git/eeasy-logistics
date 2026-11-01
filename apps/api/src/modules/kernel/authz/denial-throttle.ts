import { Logger } from '@nestjs/common';

// The rate limit of the denial audit (PLAT-10 plan 2.8): one `core.authorization.denied` row per
// principal and operation per minute, so a probing client cannot flood core_audit_log. Fixed
// one-minute windows per API process, one set of keys per window (lead review round 1): a new
// window replaces the whole set in O(1), so no key of the current window is ever evicted (a repeat
// never writes a second row), and a window admits at most `maxDenialKeys` keys; the rest of that
// minute's new denials go unaudited, logged once.

export const denialWindowMs = 60_000;
export const maxDenialKeys = 10_000;

export class DenialAuditThrottle {
  #window = Number.NaN;
  #admitted = new Set<string>();
  #fullLogged = false;
  readonly #logger = new Logger('Permissions');

  constructor(private readonly now: () => number = Date.now) {}

  /** True when `key` has no row in the current window yet and the window has room; marks it. */
  admit(key: string): boolean {
    const window = Math.floor(this.now() / denialWindowMs);
    if (window !== this.#window) {
      this.#window = window;
      this.#admitted = new Set();
      this.#fullLogged = false;
    }
    if (this.#admitted.has(key)) return false;
    if (this.#admitted.size >= maxDenialKeys) {
      if (!this.#fullLogged) {
        this.#fullLogged = true;
        this.#logger.warn(
          `More than ${maxDenialKeys} denied principal and operation pairs this minute: the rest are not audited`,
        );
      }
      return false;
    }
    this.#admitted.add(key);
    return true;
  }

  /** The number of keys admitted in the current window (for the unit test of the bound). */
  get size(): number {
    return this.#admitted.size;
  }
}
