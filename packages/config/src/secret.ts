const redacted = '[redacted]';

/**
 * A secret configuration value. It prints as `[redacted]` through `String()`, template literals,
 * `JSON.stringify` and Node's `util.inspect` (so logging the config object shows no secret); the
 * value is read only through `reveal()`, at the point of use.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return redacted;
  }

  toJSON(): string {
    return redacted;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return redacted;
  }
}
