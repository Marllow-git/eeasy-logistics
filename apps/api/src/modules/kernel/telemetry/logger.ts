import { findContext } from '@eeasy-logistics/db';
import type { LogLevel } from '@eeasy-logistics/config';
import { logLevels } from '@eeasy-logistics/config';
import type { LogAttributes } from '@opentelemetry/api-logs';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { trace } from '@opentelemetry/api';
import type { LoggerService } from '@nestjs/common';
import { currentClientRequestId, currentRequestId } from '../request/request-id.js';
import { redactText, redactValue } from './redact.js';

// The JSON logger of the api and worker (PLAT-14 plan 2.4): Nest's logger replaced by one JSON
// line per event on stdout, `ts`, `level`, `msg`, `context`, `request_id`, `account_id`,
// `trace_id`, `span_id`, `service`, `release`, every argument through the telemetry redactor; the
// same record goes to the OpenTelemetry logs API (exported over OTLP when an endpoint is set).
// main.ts installs it with `Logger.overrideLogger`, so every `new Logger(context)` of the kernel
// and the worker writes through it. The migrate role keeps Nest's console logger.

/** One log line as written. */
export interface LogLine {
  readonly ts: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly context?: string;
  readonly request_id?: string;
  readonly client_request_id?: string;
  readonly account_id?: string;
  readonly trace_id?: string;
  readonly span_id?: string;
  readonly service: string;
  readonly release: string;
  readonly stack?: string;
  readonly data?: unknown;
}

export interface JsonLoggerOptions {
  readonly service: string;
  readonly release: string;
  readonly level: LogLevel;
  /** Where lines go; stdout by default (tests capture them). */
  readonly write?: (line: string) => void;
}

const severity: Readonly<Record<LogLevel, SeverityNumber>> = {
  error: SeverityNumber.ERROR,
  warn: SeverityNumber.WARN,
  info: SeverityNumber.INFO,
  debug: SeverityNumber.DEBUG,
};

/** Frames of a stack, without its first line (the message, which may carry data). */
function framesOf(stack: string): string {
  return redactText(
    stack
      .split('\n')
      .filter((line) => line.trimStart().startsWith('at '))
      .slice(0, 12)
      .join('\n'),
    4_000,
  );
}

/** Nest passes the logger's context last, and for `error` a stack before it. */
function split(
  params: readonly unknown[],
  withStack: boolean,
): { context?: string; stack?: string; extra: unknown[] } {
  const rest = [...params];
  let context: string | undefined;
  let stack: string | undefined;
  if (rest.length > 0 && typeof rest.at(-1) === 'string') context = rest.pop() as string;
  if (withStack && rest.length > 0 && typeof rest.at(-1) === 'string') stack = rest.pop() as string;
  return {
    ...(context === undefined ? {} : { context }),
    ...(stack === undefined ? {} : { stack }),
    extra: rest,
  };
}

export class JsonLogger implements LoggerService {
  readonly #options: JsonLoggerOptions;
  readonly #rank: number;
  readonly #write: (line: string) => void;

  constructor(options: JsonLoggerOptions) {
    this.#options = options;
    this.#rank = logLevels.indexOf(options.level);
    this.#write = options.write ?? ((line) => process.stdout.write(line));
  }

  error(message: unknown, ...params: unknown[]): void {
    this.#emit('error', message, split(params, true));
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.#emit('error', message, split(params, true));
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.#emit('warn', message, split(params, false));
  }

  log(message: unknown, ...params: unknown[]): void {
    this.#emit('info', message, split(params, false));
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.#emit('debug', message, split(params, false));
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.#emit('debug', message, split(params, false));
  }

  /** The line for `message` at `level`; exported for the shape test. */
  line(
    level: LogLevel,
    message: unknown,
    parts: { context?: string; stack?: string; extra: unknown[] } = { extra: [] },
  ): LogLine {
    const span = trace.getActiveSpan()?.spanContext();
    const requestId = currentRequestId();
    const clientRequestId = currentClientRequestId();
    const accountId = findContext()?.accountId;
    let msg: string;
    let stack = parts.stack;
    let data: unknown;
    if (message instanceof Error) {
      msg = `${message.name}: ${redactText(message.message, 500)}`;
      stack ??= message.stack;
    } else if (typeof message === 'string') {
      msg = redactText(message);
    } else {
      msg = '';
      data = redactValue(message);
    }
    if (parts.extra.length > 0) {
      data = redactValue(data === undefined ? parts.extra : [data, ...parts.extra]);
    }
    return {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(parts.context === undefined ? {} : { context: redactText(parts.context, 100) }),
      ...(requestId === undefined ? {} : { request_id: requestId }),
      ...(clientRequestId === undefined ? {} : { client_request_id: clientRequestId }),
      ...(accountId === undefined ? {} : { account_id: accountId }),
      ...(span === undefined ? {} : { trace_id: span.traceId, span_id: span.spanId }),
      service: this.#options.service,
      release: this.#options.release,
      ...(stack === undefined ? {} : { stack: framesOf(stack) }),
      ...(data === undefined ? {} : { data }),
    };
  }

  #emit(
    level: LogLevel,
    message: unknown,
    parts: { context?: string; stack?: string; extra: unknown[] },
  ): void {
    if (logLevels.indexOf(level) > this.#rank) return;
    try {
      const line = this.line(level, message, parts);
      this.#write(`${JSON.stringify(line)}\n`);
      const attributes: LogAttributes = {};
      for (const key of ['context', 'request_id', 'account_id'] as const) {
        const value = line[key];
        if (value !== undefined) attributes[key] = value;
      }
      logs.getLogger('elx').emit({
        severityNumber: severity[level],
        severityText: level.toUpperCase(),
        body: line.msg,
        attributes,
      });
    } catch {
      // A log line never fails the code that writes it.
    }
  }
}
