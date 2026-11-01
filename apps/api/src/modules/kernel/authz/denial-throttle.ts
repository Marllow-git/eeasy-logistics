// The rate limit of the denial audit (PLAT-10 plan 2.8): one `core.authorization.denied` row per
// principal and operation per minute, so a probing client cannot flood core_audit_log. Fixed
// one-minute windows per API process; the map is bounded, so many principals cannot grow it
// without limit (a full map forgets its oldest keys first).

export const denialWindowMs = 60_000;
const maxKeys = 10_000;

export class DenialAuditThrottle {
  /** Key → the window it was last admitted in. Map order is insertion order: oldest first. */
  readonly #admitted = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** True when `key` has no row in the current window yet; marks it. */
  admit(key: string): boolean {
    const window = Math.floor(this.now() / denialWindowMs);
    if (this.#admitted.get(key) === window) return false;
    this.#admitted.delete(key);
    if (this.#admitted.size >= maxKeys) {
      for (const [old, at] of this.#admitted) {
        if (at === window && this.#admitted.size < maxKeys) break;
        this.#admitted.delete(old);
      }
    }
    this.#admitted.set(key, window);
    return true;
  }

  /** The number of keys held (for the unit test of the bound). */
  get size(): number {
    return this.#admitted.size;
  }
}
