import type { AppEnv } from '@eeasy-logistics/config';

/**
 * The kernel `ObjectStorage` port (integrations §2.6; ADR-0015), as far as PLAT-8 needs it:
 * `deleteMany` runs only from the outbox kind `storage_lifecycle`. Signing, `head` and `put`, and
 * the S3-compatible adapter, are OPS-1's.
 */
export interface ObjectStorage {
  /** Deletes every key; a key that is already gone is not an error (retries repeat a batch). */
  deleteMany(keys: readonly string[]): Promise<void>;
}

/** Thrown when the stub is asked for outside `local` and `ci`. */
export class StubStorageRefused extends Error {
  constructor(env: AppEnv) {
    super(`The stub object storage runs only in local and ci, not in ${env}`);
    this.name = 'StubStorageRefused';
  }
}

/**
 * The PLAT-8 stub (plan 2.5): remembers the keys it was asked to delete and deletes nothing. It
 * refuses to exist outside `local` and `ci`, so no deployed worker can believe it deleted objects.
 */
export class StubObjectStorage implements ObjectStorage {
  readonly #deleted: string[] = [];

  constructor(env: AppEnv) {
    if (env !== 'local' && env !== 'ci') throw new StubStorageRefused(env);
  }

  /** The keys deleted so far, in order (tests). */
  get deleted(): readonly string[] {
    return this.#deleted;
  }

  deleteMany(keys: readonly string[]): Promise<void> {
    this.#deleted.push(...keys);
    return Promise.resolve();
  }
}
