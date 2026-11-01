import { errorMessage, fieldMessage } from '@eeasy-logistics/i18n/errors';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestIdHeader, requestIdOf } from '../request/request-id.js';
import type { FieldProblem } from './api-exception.js';
import { ApiException } from './api-exception.js';
import type { ErrorCode } from './error-codes.js';
import { errorStatus } from './error-codes.js';
import { resolveLocale } from './locale.js';

/** The contract's `Error` schema (contracts README §4). */
export interface ErrorBody {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly request_id: string;
}

interface Resolved {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly fields?: readonly FieldProblem[];
  readonly headers?: Readonly<Record<string, string>>;
}

const internal: Resolved = { code: 'internal_error', status: errorStatus.internal_error };

/** At most this many `details.fields[]` entries; more sets `details.truncated` (adversary L-6). */
export const maxFieldProblems = 50;

/** The code a framework exception of `status` becomes (PLAT-6 plan 2.2). */
export function codeForStatus(status: number): ErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404 || status === 405) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'validation_failed';
  return 'internal_error';
}

/** `fields[]` a validation pipe put on its exception response, kept only when well formed. */
function fieldsOf(response: unknown): FieldProblem[] | undefined {
  const fields = (response as { fields?: unknown } | null)?.fields;
  if (!Array.isArray(fields)) return undefined;
  const valid = fields.filter(
    (field): field is FieldProblem =>
      typeof (field as FieldProblem | null)?.pointer === 'string' &&
      ['required', 'invalid', 'too_long'].includes((field as FieldProblem).code),
  );
  return valid.length > 0 ? valid : undefined;
}

/**
 * Maps anything thrown to a code. Only `ApiException` carries details; a framework exception keeps
 * its status class and nothing else (its text may echo input); everything else is
 * `internal_error` with no detail at all.
 */
export function resolveException(exception: unknown): Resolved {
  if (exception instanceof ApiException) {
    return { code: exception.code, status: exception.status, ...exception.options };
  }
  let status: number | undefined;
  let response: unknown;
  if (exception instanceof HttpException) {
    status = exception.getStatus();
    response = exception.getResponse();
  } else {
    // http-errors from Express's body parser (malformed JSON, too large): `expose` marks a 4xx.
    const failure = exception as { expose?: unknown; status?: unknown } | null;
    if (failure?.expose === true && typeof failure.status === 'number') status = failure.status;
  }
  if (status === undefined) return internal;
  const code = codeForStatus(status);
  if (code === 'internal_error') return internal;
  const fields = code === 'validation_failed' ? fieldsOf(response) : undefined;
  return { code, status: errorStatus[code], ...(fields === undefined ? {} : { fields }) };
}

/**
 * The one global exception filter (PLAT-6 plan 2.2): every non-2xx answer is the `Error` schema
 * with the request id and a message in the caller's language. A response never carries a stack, a
 * query or an input value; a 500 is logged with its error class, SQLSTATE and stack frames only.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const resolved = resolveException(exception);
    if (resolved.status >= 500) this.logger.error(describeFailure(exception));
    if (response.headersSent) return;

    const requestId = requestIdOf(request);
    const locale = resolveLocale(request.headers['accept-language']);
    const truncated = (resolved.fields?.length ?? 0) > maxFieldProblems;
    const details =
      resolved.fields === undefined
        ? resolved.details
        : {
            ...resolved.details,
            ...(truncated ? { truncated: true } : {}),
            fields: resolved.fields.slice(0, maxFieldProblems).map((field) => ({
              pointer: field.pointer,
              code: field.code,
              message: fieldMessage(locale, field.code),
            })),
          };
    const body: ErrorBody = {
      code: resolved.code,
      message: errorMessage(locale, resolved.code),
      ...(details === undefined ? {} : { details }),
      request_id: requestId,
    };
    response.setHeader(requestIdHeader, requestId);
    response.setHeader('Content-Language', locale);
    for (const [name, value] of Object.entries(resolved.headers ?? {})) {
      response.setHeader(name, value);
    }
    response.status(resolved.status).json(body);
  }
}

/** A log line for an unexpected failure: class, SQLSTATE and frames, never the message text. */
export function describeFailure(exception: unknown): string {
  if (!(exception instanceof Error)) return `Unexpected failure: ${typeof exception}`;
  const sqlState =
    (exception as { code?: unknown; cause?: { code?: unknown } }).code ??
    (exception as { cause?: { code?: unknown } }).cause?.code;
  const frames = (exception.stack ?? '')
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .slice(0, 8)
    .join('\n');
  const state = typeof sqlState === 'string' ? ` (SQLSTATE ${sqlState})` : '';
  return `Unexpected ${exception.name}${state}\n${frames}`;
}
