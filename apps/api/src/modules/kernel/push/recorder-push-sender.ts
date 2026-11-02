import { randomUUID } from 'node:crypto';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { withPortSpan } from '../telemetry/port-span.js';
import type {
  PushCallContext,
  PushMessage,
  PushReceipt,
  PushSender,
  PushTicket,
} from './push-sender.js';
import { deviceNotRegistered, maxPushBatch, maxReceiptIds } from './push-sender.js';

// The in-memory recorder (INT-4 plan 2.2; integrations §2.5 "Stub", §9: local and ci). No network:
// it keeps the messages it was given, answers `ok` tickets with fresh ids and `ok` receipts, and
// lets a test plant a ticket or receipt error for a token, or a rate limit on the next send.

/** The recorder keeps at most this many messages (a local worker runs for days). */
export const recorderCapacity = 1_000;

export class RecorderPushSender implements PushSender {
  readonly provider = 'stub' as const;
  readonly #messages: PushMessage[] = [];
  readonly #ticketErrors = new Map<string, string>();
  readonly #receiptErrors = new Map<string, string>();
  /** The token of each ticket id, for planted receipt errors. */
  readonly #ticketTokens = new Map<string, string>();
  #nextFailure: ProviderFailure | undefined;

  /** The messages sent, oldest first (at most `recorderCapacity`). */
  get messages(): readonly PushMessage[] {
    return [...this.#messages];
  }

  /** The tokens sent to, oldest first. */
  get tokens(): readonly string[] {
    return this.#messages.map((message) => message.to);
  }

  /** Every later send to `token` gets an error ticket (`DeviceNotRegistered` by default). */
  planTicketError(token: string, error: string = deviceNotRegistered): void {
    this.#ticketErrors.set(token, error);
  }

  /** The receipt of every later ticket to `token` is an error (`DeviceNotRegistered` by default). */
  planReceiptError(token: string, error: string = deviceNotRegistered): void {
    this.#receiptErrors.set(token, error);
  }

  /** The next send fails as the push service's 429 would, then sends resume. */
  rateLimitNextSend(retryAfterS: number): void {
    this.failNextSend(
      new ProviderFailure('rate_limited', 'the push service is rate limiting', {
        status: 429,
        retryAfterS,
      }),
    );
  }

  /** The next send throws `failure` (any `ProviderFailure`), then sends resume. */
  failNextSend(failure: ProviderFailure): void {
    this.#nextFailure = failure;
  }

  /** Forgets everything recorded and planted. */
  clear(): void {
    this.#messages.length = 0;
    this.#ticketErrors.clear();
    this.#receiptErrors.clear();
    this.#ticketTokens.clear();
    this.#nextFailure = undefined;
  }

  send(messages: readonly PushMessage[], call: PushCallContext = {}): Promise<PushTicket[]> {
    return withPortSpan(
      {
        port: 'push_sender',
        method: 'send',
        provider: this.provider,
        ...(call.accountId === undefined ? {} : { accountId: call.accountId }),
        ...(call.outboxRowId === undefined ? {} : { outboxRowId: call.outboxRowId }),
        ...(call.attempt === undefined ? {} : { attempt: call.attempt }),
      },
      () => {
        if (messages.length > maxPushBatch) {
          throw new ProviderFailure('permanent', `at most ${maxPushBatch} messages per request`, {
            status: 'PUSH_TOO_MANY_NOTIFICATIONS',
          });
        }
        const failure = this.#nextFailure;
        if (failure !== undefined) {
          this.#nextFailure = undefined;
          throw failure;
        }
        const tickets = messages.map((message, index): PushTicket => {
          this.#record(message);
          const error = this.#ticketErrors.get(message.to);
          if (error !== undefined) return { index, status: 'error', error };
          const id = randomUUID();
          this.#ticketTokens.set(id, message.to);
          return { index, status: 'ok', id };
        });
        return Promise.resolve(tickets);
      },
    );
  }

  receipts(ids: readonly string[]): Promise<PushReceipt[]> {
    return withPortSpan(
      { port: 'push_sender', method: 'receipts', provider: this.provider },
      () => {
        if (ids.length > maxReceiptIds) {
          throw new ProviderFailure('permanent', `at most ${maxReceiptIds} ids per request`, {
            status: 'PUSH_TOO_MANY_RECEIPTS',
          });
        }
        return Promise.resolve(
          [...new Set(ids)].map((id): PushReceipt => {
            const token = this.#ticketTokens.get(id);
            const error = token === undefined ? undefined : this.#receiptErrors.get(token);
            return error === undefined ? { id, status: 'ok' } : { id, status: 'error', error };
          }),
        );
      },
    );
  }

  #record(message: PushMessage): void {
    this.#messages.push(message);
    if (this.#messages.length > recorderCapacity) this.#messages.shift();
    if (this.#ticketTokens.size > recorderCapacity * 10) {
      const oldest = this.#ticketTokens.keys().next().value;
      if (oldest !== undefined) this.#ticketTokens.delete(oldest);
    }
  }
}
