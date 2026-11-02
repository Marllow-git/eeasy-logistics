/** A small observable value for `useSyncExternalStore`. */
export class Store<T extends object> {
  private readonly listeners = new Set<() => void>();

  constructor(private value: T) {}

  get = (): T => this.value;

  set(patch: Partial<T>): void {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
