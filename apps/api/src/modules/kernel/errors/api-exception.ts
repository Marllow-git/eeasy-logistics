import type { FieldMessageCode } from '@eeasy-logistics/i18n/errors';
import type { ErrorCode } from './error-codes.js';
import { errorStatus } from './error-codes.js';

/** One problem inside `details.fields[]` (contracts README §4); the filter adds the message. */
export interface FieldProblem {
  /** JSON pointer into the request: `/body/name`, `/query/limit`, `/header/x-support-reason`. */
  readonly pointer: string;
  readonly code: FieldMessageCode;
}

export interface ApiExceptionOptions {
  /** Code-specific `details` (README §4); never a stack, a query or an echoed secret. */
  readonly details?: Readonly<Record<string, unknown>>;
  /** `validation_failed` only: the fields at fault. */
  readonly fields?: readonly FieldProblem[];
  /** Response headers the code needs (`Retry-After`). */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A known failure with a code of errors.md (PLAT-6 plan 2.2). The HTTP status comes from the code's
 * row, so a code and its status can never disagree. The global filter renders it as `Error`.
 */
export class ApiException extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly options: ApiExceptionOptions;

  constructor(code: ErrorCode, options: ApiExceptionOptions = {}) {
    super(code);
    this.name = 'ApiException';
    this.code = code;
    this.status = errorStatus[code];
    this.options = options;
  }
}
