// The Eeasy WhatsApp engine's command door and callbacks, as the stub plays them (PLAT-9 plan 2A.7;
// ADR-0041; engine contract §2–§5). Dependency-free. The stub verifies signed commands exactly as
// the engine does (§2.3 order: size, service, key id, timestamp, header shape, constant-time HMAC,
// body hash, nonce), accepts `message.send.verification`, `message.send.text` and `message.status`,
// dedupes by (instance, idempotency key) and, when a callback base is configured, posts signed
// `message.status` callbacks (`sent`, then `delivered`) the way the engine's poster does.

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export const commandPath = '/internal/v1/commands';
export const callbackPath = '/internal/whatsapp/v1/callbacks';
export const engineIdentity = 'eeasy-whatsapp-engine';
export const maxBodyBytes = 262_144;

const nonceShape = /^[0-9a-f]{32}$/;
const hashShape = /^[0-9a-f]{64}$/;
const signatureShape = /^v1=[0-9a-f]{64}$/;
const instantShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const e164 = /^\+[1-9][0-9]{6,17}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contract §6.1–§6.3: the types each send command carries, their priority and hold. */
const types = {
  verification: { command: 'message.send.verification', priority: 1, holdS: 600 },
  shipment_issued: { command: 'message.send.text', priority: 2, holdS: 86_400 },
  digest_daily: { command: 'message.send.text', priority: 3, holdS: 21_600 },
  digest_weekly: { command: 'message.send.text', priority: 3, holdS: 86_400 },
  digest_monthly: { command: 'message.send.text', priority: 3, holdS: 86_400 },
  manual_custom: { command: 'message.send.text', priority: 4, holdS: 86_400 },
  connection_test: { command: 'message.send.text', priority: 4, holdS: 600 },
};

const textKeys = new Set([
  'to_number',
  'body',
  'locale',
  'lane_key',
  'template_version',
  'suppression_check',
  'availability_policy',
  'business_expires_at',
  'predecessor_eeasy_message_id',
  'recipient_check',
]);
const verificationKeys = new Set([
  'to_number',
  'body',
  'locale',
  'lane_key',
  'suppression_check',
  'recipient_check',
]);
const envelopeKeys = [
  'command',
  'eeasy_account_id',
  'eeasy_store_id',
  'sender_instance_id',
  'eeasy_message_id',
  'message_type',
  'priority_class',
  'expires_at',
  'idempotency_key',
  'payload',
];

export function instant(ms) {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

export function canonical(method, path, service, keyId, timestamp, nonce, bodyHash) {
  return ['v1', method.toUpperCase(), path, service, keyId, timestamp, nonce, bodyHash].join('\n');
}

export function sign(text, secret) {
  return `v1=${createHmac('sha256', secret).update(text, 'utf8').digest('hex')}`;
}

export function sha256(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

/** The six `X-Eeasy-*` headers of a request signed with `key` ({ service, keyId, secret }). */
export function signedHeaders(key, path, raw, now = Date.now()) {
  const timestamp = instant(now);
  const nonce = randomBytes(16).toString('hex');
  const bodyHash = sha256(raw);
  return {
    'x-eeasy-service': key.service,
    'x-eeasy-key-id': key.keyId,
    'x-eeasy-timestamp': timestamp,
    'x-eeasy-nonce': nonce,
    'x-eeasy-body-sha256': bodyHash,
    'x-eeasy-signature': sign(
      canonical('POST', path, key.service, key.keyId, timestamp, nonce, bodyHash),
      key.secret,
    ),
  };
}

function failure(status, code, message) {
  return { status, body: { ok: false, error: { code, message, retryable: false } } };
}

/** The engine settings the stub needs, from its environment (the same names as the API's). */
export function engineSettingsFromEnv(env) {
  return {
    serviceId: env.WHATSAPP_ENGINE_SERVICE_ID ?? 'eeasy-laravel-control-plane',
    keyId: env.WHATSAPP_ENGINE_KEY_ID,
    commandSecret: env.WHATSAPP_ENGINE_COMMAND_SECRET,
    callbackKeyId: env.WHATSAPP_ENGINE_CALLBACK_KEY_ID,
    callbackSecret: env.WHATSAPP_ENGINE_CALLBACK_SECRET,
    callbackBase: env.WHATSAPP_STUB_CALLBACK_URL || undefined,
  };
}

/**
 * The command door. `settings`: { serviceId, keyId, commandSecret, callbackKeyId, callbackSecret,
 * callbackBase }; `record(entry)` stores an accepted send for `GET /sent`.
 */
export function createEngine(settings, record, now = Date.now) {
  const nonces = new Set();
  /** `${instance} ${idempotency key}` → the accepted message. */
  const accepted = new Map();
  /** eeasy_message_id → the accepted message. */
  const byId = new Map();
  let acceptSeq = 0;
  const pending = new Set();

  /** Contract §2.3 steps 2–6, from the headers alone; null when they pass. */
  function verifyHeaders(headers, path) {
    if (headers['x-eeasy-service'] !== settings.serviceId) {
      return failure(401, 'AUTH_UNKNOWN_SERVICE', 'unknown service');
    }
    if (settings.commandSecret === undefined || headers['x-eeasy-key-id'] !== settings.keyId) {
      return failure(401, 'AUTH_UNKNOWN_KEY', 'unknown key');
    }
    const timestamp = headers['x-eeasy-timestamp'] ?? '';
    const ms = Date.parse(timestamp);
    if (!instantShape.test(timestamp) || !Number.isFinite(ms) || Math.abs(now() - ms) > 60_000) {
      return failure(401, 'AUTH_STALE_TIMESTAMP', 'stale timestamp');
    }
    const nonce = headers['x-eeasy-nonce'] ?? '';
    const claimed = headers['x-eeasy-body-sha256'] ?? '';
    if (!nonceShape.test(nonce) || !hashShape.test(claimed)) {
      return failure(401, 'AUTH_MALFORMED_HEADER', 'malformed header');
    }
    const provided = headers['x-eeasy-signature'] ?? '';
    const expected = sign(
      canonical('POST', path, settings.serviceId, settings.keyId, timestamp, nonce, claimed),
      settings.commandSecret,
    );
    if (
      !signatureShape.test(provided) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
    ) {
      return failure(401, 'AUTH_BAD_SIGNATURE', 'bad signature');
    }
    return null;
  }

  /** Contract §2.3 steps 7–8 and the command itself; returns { status, body }. */
  function handle(headers, raw) {
    if (sha256(raw) !== headers['x-eeasy-body-sha256']) {
      return failure(401, 'AUTH_BODY_HASH_MISMATCH', 'body hash mismatch');
    }
    const nonceKey = `${settings.serviceId} ${headers['x-eeasy-nonce']}`;
    if (nonces.has(nonceKey)) return failure(401, 'AUTH_REPLAYED_NONCE', 'replayed nonce');
    nonces.add(nonceKey);
    let envelope;
    try {
      envelope = JSON.parse(raw.toString('utf8'));
    } catch {
      return failure(422, 'SCHEMA_INVALID', 'body is not JSON');
    }
    const problem = checkEnvelope(envelope);
    if (problem !== null) return failure(422, problem.code, problem.message);
    const reply = (result) => ({
      status: 200,
      body: {
        ok: true,
        command: envelope.command,
        eeasy_message_id: envelope.eeasy_message_id,
        sender_instance_id: envelope.sender_instance_id,
        result,
        engine_build_sha: 'whatsapp-stub',
        server_time: instant(now()),
      },
    });
    if (envelope.command === 'message.status') {
      const found = byId.get(envelope.eeasy_message_id);
      if (found === undefined || found.instance !== envelope.sender_instance_id) {
        return reply({ exists: false, eeasy_message_id: envelope.eeasy_message_id });
      }
      return reply({
        exists: true,
        eeasy_message_id: found.id,
        sender_instance_id: found.instance,
        status: found.status,
        accept_seq: found.acceptSeq,
      });
    }
    const key = `${envelope.sender_instance_id} ${envelope.idempotency_key}`;
    const previous = accepted.get(key);
    if (previous !== undefined) {
      return reply({
        eeasy_message_id: previous.id,
        status: previous.status,
        accept_seq: previous.acceptSeq,
        duplicate: true,
      });
    }
    acceptSeq += 1;
    const message = {
      id: envelope.eeasy_message_id,
      instance: envelope.sender_instance_id,
      account: envelope.eeasy_account_id,
      type: envelope.message_type,
      status: 'accepted',
      acceptSeq,
    };
    accepted.set(key, message);
    byId.set(message.id, message);
    record({
      id: message.id,
      receivedAt: new Date(now()).toISOString(),
      path: commandPath,
      body: envelope,
    });
    scheduleCallbacks(message);
    return reply({
      eeasy_message_id: message.id,
      status: 'accepted',
      accept_seq: acceptSeq,
      expires_at: envelope.expires_at,
      duplicate: false,
    });
  }

  function checkEnvelope(envelope) {
    const schema = (message) => ({ code: 'SCHEMA_INVALID', message });
    if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return schema('envelope is not an object');
    }
    const keys = Object.keys(envelope);
    if (keys.length !== envelopeKeys.length || !envelopeKeys.every((k) => keys.includes(k))) {
      return schema('envelope fields are not the contract §3 set');
    }
    if (!Number.isInteger(envelope.eeasy_account_id) || envelope.eeasy_account_id < 1) {
      return schema('eeasy_account_id');
    }
    if (
      typeof envelope.sender_instance_id !== 'string' ||
      !uuid.test(envelope.sender_instance_id)
    ) {
      return schema('sender_instance_id');
    }
    if (typeof envelope.eeasy_message_id !== 'string' || !uuid.test(envelope.eeasy_message_id)) {
      return schema('eeasy_message_id');
    }
    const payload = envelope.payload;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return schema('payload');
    }
    if (envelope.command === 'message.status') {
      return Object.keys(payload).length === 0 ? null : schema('message.status takes no payload');
    }
    const type = types[envelope.message_type];
    if (type === undefined || type.command !== envelope.command) {
      return schema('message_type is not carried by this command');
    }
    if (envelope.priority_class !== type.priority) {
      return { code: 'PRIORITY_MISMATCH', message: 'priority_class' };
    }
    const expires = Date.parse(envelope.expires_at ?? '');
    if (!Number.isFinite(expires) || Math.abs(expires - (now() + type.holdS * 1000)) > 120_000) {
      return { code: 'EXPIRY_MISMATCH', message: 'expires_at' };
    }
    if (typeof envelope.idempotency_key !== 'string' || envelope.idempotency_key.length > 255) {
      return schema('idempotency_key');
    }
    const allowed = envelope.command === 'message.send.verification' ? verificationKeys : textKeys;
    for (const name of Object.keys(payload)) {
      if (!allowed.has(name)) return schema(`payload field ${name}`);
    }
    for (const value of Object.values(payload)) {
      if (typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value.trim())) {
        return { code: 'PAYLOAD_URL_FORBIDDEN', message: 'absolute URL in payload' };
      }
    }
    if (typeof payload.to_number !== 'string' || !e164.test(payload.to_number)) {
      return schema('to_number');
    }
    if (typeof payload.body !== 'string' || payload.body === '') return schema('body');
    if (payload.locale !== 'ar' && payload.locale !== 'en') return schema('locale');
    if (typeof payload.lane_key !== 'string' || payload.lane_key === '') return schema('lane_key');
    if (envelope.command === 'message.send.verification' && payload.suppression_check !== false) {
      return schema('suppression_check must be false for a verification');
    }
    if (
      envelope.command === 'message.send.text' &&
      typeof payload.suppression_check !== 'boolean'
    ) {
      return schema('suppression_check');
    }
    return null;
  }

  /** `sent`, then `delivered`, each a signed `message.status` callback (contract §5.1). */
  function scheduleCallbacks(message) {
    if (settings.callbackBase === undefined || settings.callbackSecret === undefined) return;
    const steps = [
      ['sent', 'accepted'],
      ['delivered', 'sent'],
    ];
    const wire = `3EB0${randomBytes(8).toString('hex').toUpperCase()}`;
    const run = async () => {
      for (const [status, previous] of steps) {
        message.status = status;
        await postCallback({
          callback: 'message.status',
          eeasy_account_id: message.account,
          eeasy_store_id: null,
          sender_instance_id: message.instance,
          eeasy_message_id: message.id,
          message_type: message.type,
          status,
          previous_status: previous,
          occurred_at: instant(now()),
          wire_message_id: wire,
          ack: status === 'sent' ? 'server' : 'device',
          attempt: 1,
          accept_seq: message.acceptSeq,
          error: null,
          callback_id: randomUUID(),
        }).catch(() => undefined);
      }
    };
    const job = run().finally(() => pending.delete(job));
    pending.add(job);
  }

  /** One signed callback to `<callbackBase>/internal/whatsapp/v1/callbacks`; resolves the status. */
  function postCallback(body) {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const base = new URL(settings.callbackBase);
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'content-length': raw.length,
      ...signedHeaders(
        { service: engineIdentity, keyId: settings.callbackKeyId, secret: settings.callbackSecret },
        callbackPath,
        raw,
        now(),
      ),
    };
    const send = base.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(
        {
          protocol: base.protocol,
          hostname: base.hostname,
          port: base.port,
          method: 'POST',
          path: callbackPath,
          headers,
          timeout: 5_000,
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('timeout', () => req.destroy(new Error('callback timed out')));
      req.on('error', reject);
      req.end(raw);
    });
  }

  /** The last verification body sent to `to`, and the six-digit code in it (integrations §2.4). */
  function lastCode(sent, to) {
    for (let index = sent.length - 1; index >= 0; index -= 1) {
      const body = sent[index]?.body;
      if (body?.command === 'message.send.verification' && body.payload?.to_number === to) {
        const code = /\b(\d{6})\b/.exec(body.payload.body)?.[1] ?? null;
        return { to, eeasy_message_id: body.eeasy_message_id, body: body.payload.body, code };
      }
    }
    return null;
  }

  return {
    verifyHeaders,
    handle,
    lastCode,
    postCallback,
    /** Waits for the callbacks in flight (tests). */
    settle: () => Promise.all([...pending]),
  };
}
