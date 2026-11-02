import { uuidv7 } from '@eeasy-logistics/db';
import { locales } from '@eeasy-logistics/i18n/push';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { KindHandler, KindOutcome, OutboxRow, RelayRow } from '../outbox/kind-handlers.js';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { getMetrics } from '../telemetry/metrics.js';
import type { PushTokenInvalidations } from './invalidations.js';
import type { PushMessage, PushSender, PushTicket } from './push-sender.js';
import { deviceNotRegistered, maxPushBatch } from './push-sender.js';
import type { PushTemplateKey } from './push-templates.js';
import {
  isPushTemplateKey,
  pushParamsProblem,
  pushTemplates,
  renderPush,
} from './push-templates.js';

// The `push` outbox handler (INT-4 plan 2.3; integrations §2.5, §4.1 to §4.4; driver app §8.2): a
// Delivery consumer writes one row per driver and notification; the handler validates it, renders
// the title and body in the row's locale, sends one message per device in one batch, keeps a ticket
// per accepted message for the receipts job, and hands every `DeviceNotRegistered` to the token
// invalidation registry. The payload's `data` is ids only, plus `push_id` (the row id) so the app
// shows a redelivered push once. No token, title, body or `data` reaches a log, span or row error.

/** The deep links of driver app §8.2, by the `kind` they serve. */
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const routePattern = new RegExp(
  `^eeasydriver://(offers/${uuidPattern}|orders/${uuidPattern}|cash|sync)$`,
);

/** An Expo push token (`ExponentPushToken[…]` or `ExpoPushToken[…]`). */
export const pushTokenPattern = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

export const pushKinds = ['offer', 'assignment', 'cancellation', 'cash', 'sync'] as const;
export type PushKind = (typeof pushKinds)[number];

/** Expo keeps a push up to 30 days. */
export const maxTtlSeconds = 2_592_000;

const pushData = z
  .strictObject({
    kind: z.enum(pushKinds),
    offer_id: z.uuid().optional(),
    order_id: z.uuid().optional(),
    route: z.string().max(128).regex(routePattern),
  })
  .superRefine((data, ctx) => {
    // The route opens what the kind names, for the id the data carries.
    const expected: Record<PushKind, string | undefined> = {
      offer: data.offer_id === undefined ? undefined : `eeasydriver://offers/${data.offer_id}`,
      assignment: data.order_id === undefined ? undefined : `eeasydriver://orders/${data.order_id}`,
      cancellation:
        data.order_id === undefined ? undefined : `eeasydriver://orders/${data.order_id}`,
      cash: 'eeasydriver://cash',
      sync: 'eeasydriver://sync',
    };
    if (expected[data.kind] !== data.route) {
      ctx.addIssue({ code: 'custom', message: 'route does not match kind and ids' });
    }
  });

/** A `push` row's payload (plan 2.3), written by the Delivery producers (DEL-2, DEL-6, DEL-8, DRV-6). */
export const pushPayload = z
  .strictObject({
    driver_id: z.uuid(),
    template: z.string().refine(isPushTemplateKey),
    params: z.record(z.string(), z.string()).default({}),
    locale: z.enum(locales),
    data: pushData,
    ttl_s: z.int().min(1).max(maxTtlSeconds),
    collapse_id: z
      .string()
      .regex(/^[A-Za-z0-9:_-]{1,64}$/)
      .optional(),
    /** When the offer (or whatever the push is about) stops mattering; required for an offer. */
    expires_at: z.iso.datetime({ offset: true }).optional(),
    devices: z
      .array(
        z.strictObject({ device_id: z.uuid(), push_token: z.string().regex(pushTokenPattern) }),
      )
      .max(maxPushBatch),
  })
  .refine((payload) => payload.data.kind !== 'offer' || payload.expires_at !== undefined, {
    message: 'an offer push carries expires_at',
  });

export type PushPayload = z.infer<typeof pushPayload> & { template: PushTemplateKey };

/** A ticket the handler keeps for the receipts job. */
export interface NewPushTicket {
  readonly id: string;
  readonly outboxId: string;
  readonly deviceId: string;
  readonly ticketId: string;
}

/** Where tickets go (the platform pool's `core_push_tickets`, plan 2.4). */
export interface PushTicketWriter {
  insertTickets(accountId: string, tickets: readonly NewPushTicket[]): Promise<void>;
}

export interface PushHandlerDependencies {
  readonly sender: PushSender;
  readonly tickets: PushTicketWriter;
  readonly invalidations: PushTokenInvalidations;
  readonly now?: () => Date;
  readonly logger?: Pick<Logger, 'log' | 'warn'>;
}

/** A failure of our own token: wait 5 minutes without an attempt (plan 2.3). */
export const unauthorisedRetryS = 5 * 60;

type PushOutcomeLabel =
  | 'sent'
  | 'device_not_registered'
  | 'rate_limited'
  | 'transient'
  | 'permanent'
  | 'unauthorised'
  | 'stale'
  | 'no_device';

const count = (outcome: PushOutcomeLabel, n = 1) => {
  if (n > 0) getMetrics().add('push_messages_total', n, { outcome });
};

/** A row that can never be sent: dead at once, with a fixed message (never the payload). */
const deadRow = (status: string, message: string): KindOutcome => ({
  outcome: 'dead',
  error: { status, message },
});

export class PushKindHandler implements KindHandler {
  readonly kind = 'push' as const;
  readonly #deps: PushHandlerDependencies;
  readonly #logger: Pick<Logger, 'log' | 'warn'>;

  constructor(deps: PushHandlerDependencies) {
    this.#deps = deps;
    this.#logger = deps.logger ?? new Logger('PushHandler');
  }

  /** The adapter, which the worker's receipts job shares. */
  get sender(): PushSender {
    return this.#deps.sender;
  }

  /** The invalidation registry, which the worker's receipts job shares. */
  get invalidations(): PushTokenInvalidations {
    return this.#deps.invalidations;
  }

  /** Integrations §4.1: push needs no ordering. */
  orderingKey(row: RelayRow): string | null {
    void row;
    return null;
  }

  async execute(row: OutboxRow): Promise<KindOutcome> {
    const parsed = pushPayload.safeParse(row.payload);
    if (!parsed.success) {
      count('permanent');
      return deadRow('payload', 'push payload is invalid');
    }
    const payload = parsed.data as PushPayload;
    if (row.accountId === null) {
      count('permanent');
      return deadRow('payload', 'a push belongs to an account');
    }
    const problem = pushParamsProblem(payload.template, payload.params);
    if (problem !== undefined) {
      count('permanent');
      return deadRow('params', problem);
    }
    const now = this.#deps.now?.() ?? new Date();
    // Integrations §4.1: expired offers are dropped.
    let ttlSeconds = payload.ttl_s;
    if (payload.expires_at !== undefined) {
      const leftS = Math.floor((Date.parse(payload.expires_at) - now.getTime()) / 1000);
      if (leftS <= 0) {
        count('stale');
        this.#logger.log(`push skipped outbox_id=${row.id} reason=stale`);
        return { outcome: 'done', skipped: 'stale' };
      }
      ttlSeconds = Math.min(ttlSeconds, leftS);
    }
    // One message per token: two device rows that share a token get one push.
    const devices = [...new Map(payload.devices.map((d) => [d.push_token, d])).values()];
    if (devices.length === 0) {
      count('no_device');
      this.#logger.log(`push skipped outbox_id=${row.id} reason=no_device`);
      return { outcome: 'done', skipped: 'no_device' };
    }

    const definition = pushTemplates[payload.template];
    const { title, body } = renderPush(payload.template, payload.locale, payload.params);
    const data: Record<string, string> = { kind: payload.data.kind, route: payload.data.route };
    if (payload.data.offer_id !== undefined) data.offer_id = payload.data.offer_id;
    if (payload.data.order_id !== undefined) data.order_id = payload.data.order_id;
    data.push_id = row.id;
    const messages: PushMessage[] = devices.map((device) => ({
      to: device.push_token,
      title,
      body,
      data,
      ttlSeconds,
      ...(payload.collapse_id === undefined ? {} : { collapseId: payload.collapse_id }),
      channelId: definition.channelId,
      priority: definition.priority,
      sound: definition.sound,
    }));

    let tickets: PushTicket[];
    try {
      tickets = await this.#deps.sender.send(messages, {
        accountId: row.accountId,
        outboxRowId: row.id,
        attempt: row.attempts + 1,
      });
    } catch (error) {
      return this.#failed(row, error, messages.length);
    }
    return this.#accepted(row, row.accountId, devices, tickets);
  }

  /** A batch the push service answered: keep the tickets, then hand on the invalid tokens. */
  async #accepted(
    row: OutboxRow,
    accountId: string,
    devices: readonly { device_id: string }[],
    tickets: readonly PushTicket[],
  ): Promise<KindOutcome> {
    const kept: NewPushTicket[] = [];
    const unregistered: string[] = [];
    const errors = new Map<string, number>();
    for (const ticket of tickets) {
      const device = devices[ticket.index];
      if (device === undefined) continue;
      if (ticket.status === 'ok') {
        kept.push({
          id: uuidv7(),
          outboxId: row.id,
          deviceId: device.device_id,
          ticketId: ticket.id,
        });
      } else if (ticket.error === deviceNotRegistered) {
        unregistered.push(device.device_id);
      } else {
        errors.set(ticket.error, (errors.get(ticket.error) ?? 0) + 1);
      }
    }
    // The tickets first: if this write fails the row is retried, and the next send's tickets name
    // the unregistered devices again, so each reaches the registry once.
    if (kept.length > 0) await this.#deps.tickets.insertTickets(accountId, kept);
    for (const deviceId of unregistered) {
      await this.#deps.invalidations.invalidate({
        accountId,
        deviceId,
        reason: 'device_not_registered',
      });
    }
    count('sent', kept.length);
    count('device_not_registered', unregistered.length);
    let failed = 0;
    for (const [name, n] of errors) {
      failed += n;
      this.#logger.warn(`push ticket error outbox_id=${row.id} error=${name} count=${n}`);
    }
    count('permanent', failed);
    this.#logger.log(
      `push sent outbox_id=${row.id} devices=${devices.length} ok=${kept.length} ` +
        `unregistered=${unregistered.length} errors=${failed}`,
    );
    return { outcome: 'done' };
  }

  /** The whole batch failed (plan 2.3): the outbox decides by the failure's reason. */
  #failed(row: OutboxRow, error: unknown, messages: number): KindOutcome {
    if (!(error instanceof ProviderFailure)) {
      count('transient', messages);
      throw error;
    }
    const detail = {
      message: error.message,
      ...(error.status === undefined ? {} : { status: error.status }),
    };
    switch (error.reason) {
      case 'rate_limited':
        count('rate_limited', messages);
        return {
          outcome: 'retry',
          consumesAttempt: false,
          ...(error.retryAfterS === undefined ? {} : { retryAfterS: error.retryAfterS }),
          error: detail,
        };
      case 'unauthorised':
        // The platform's own access token is wrong: no connection to park; the counter alerts.
        count('unauthorised', messages);
        this.#logger.warn(
          `push service refused our access token outbox_id=${row.id} status=${String(error.status ?? 'n/a')}`,
        );
        return {
          outcome: 'retry',
          consumesAttempt: false,
          retryAfterS: unauthorisedRetryS,
          error: detail,
        };
      case 'permanent':
        count('permanent', messages);
        return { outcome: 'dead', error: detail };
      case 'transient':
        count('transient', messages);
        return { outcome: 'retry', consumesAttempt: true, error: detail };
    }
  }
}
