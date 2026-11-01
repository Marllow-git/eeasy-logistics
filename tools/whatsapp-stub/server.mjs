// WhatsApp stub for the local and ci stacks (PLAT-2 decision 2.1; integrations §9; PLAT-9 plan
// 2A.7). Dependency-free: plain Node, no install step.
//
//   POST /internal/v1/commands   the Eeasy WhatsApp engine's signed command door (engine.mjs):
//                                verification, text and message.status; with
//                                WHATSAPP_STUB_CALLBACK_URL set, signed message.status callbacks
//   GET  /v1/last-code?to=<E.164> the last verification sent to a phone and its six-digit code
//   POST <any other path>        record the send, answer 200 {"id": "..."}
//   GET  /sent                   every recorded send, oldest first
//   DELETE /sent                 forget them (test isolation)
//   GET  /health                 200 "ok"
//
// The command door reads WHATSAPP_ENGINE_SERVICE_ID, WHATSAPP_ENGINE_KEY_ID,
// WHATSAPP_ENGINE_COMMAND_SECRET (and the callback pair) from the environment, the same variables
// the API signs with; without the command secret every command is refused 401.
//
// Every send is appended as one JSON line to WHATSAPP_STUB_LOG, and the log is
// read back at start, so /sent survives a restart while the log file does.
//
// Outage simulation (integrations §9): a request header
//   x-stub-fault: 401 | 429 | 500 | <any 4xx or 5xx> | timeout | latency=<ms>
// answers with that status (429 adds Retry-After: 1), never answers (timeout),
// or delays before recording normally (latency). A faulted send is not recorded.

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { commandPath, createEngine, engineSettingsFromEnv, maxBodyBytes } from './engine.mjs';

const MAX_BODY_BYTES = 1024 * 1024;

function loadLog(logPath) {
  try {
    return readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function send(res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain' : 'application/json',
    ...headers,
  });
  res.end(text);
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseFault(value) {
  if (value === undefined) return { kind: 'none' };
  if (value === 'timeout') return { kind: 'timeout' };
  const latency = /^latency=(\d{1,6})$/.exec(value);
  if (latency) return { kind: 'latency', ms: Number(latency[1]) };
  if (/^[45]\d\d$/.test(value)) return { kind: 'status', status: Number(value) };
  return { kind: 'invalid' };
}

export function createStub({ logPath, engine: settings = {}, now = Date.now }) {
  mkdirSync(dirname(logPath), { recursive: true });
  const sent = loadLog(logPath);
  const held = new Set();
  const store = (record) => {
    appendFileSync(logPath, `${JSON.stringify(record)}\n`);
    sent.push(record);
  };
  const engine = createEngine(settings, store, now);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://stub');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, 'ok');
      if (req.method === 'GET' && url.pathname === '/sent') return send(res, 200, sent);
      if (req.method === 'DELETE' && url.pathname === '/sent') {
        sent.length = 0;
        writeFileSync(logPath, '');
        return send(res, 204, '');
      }
      if (req.method === 'GET' && url.pathname === '/v1/last-code') {
        const found = engine.lastCode(sent, url.searchParams.get('to') ?? '');
        return found === null ? send(res, 404, { error: 'no code' }) : send(res, 200, found);
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

      const fault = parseFault(req.headers['x-stub-fault']);
      if (url.pathname === commandPath && fault.kind === 'none') {
        // Engine contract §2.3: the size and the headers first, the body only once they pass.
        const declared = Number(req.headers['content-length']);
        if (!Number.isInteger(declared) || declared > maxBodyBytes) {
          return send(
            res,
            413,
            { ok: false, error: { code: 'REQUEST_TOO_LARGE' } },
            {
              connection: 'close',
            },
          );
        }
        const refused = engine.verifyHeaders(req.headers, url.pathname);
        if (refused !== null) {
          return send(res, refused.status, refused.body, { connection: 'close' });
        }
        const answer = engine.handle(req.headers, Buffer.from(await readBody(req, maxBodyBytes)));
        return send(res, answer.status, answer.body);
      }

      const raw = await readBody(req);
      if (fault.kind === 'invalid') return send(res, 400, { error: 'unknown x-stub-fault' });
      if (fault.kind === 'timeout') {
        held.add(res);
        res.on('close', () => held.delete(res));
        return undefined;
      }
      if (fault.kind === 'status') {
        const headers = fault.status === 429 ? { 'retry-after': '1' } : {};
        return send(res, fault.status, { error: `simulated ${fault.status}` }, headers);
      }
      if (fault.kind === 'latency') await new Promise((r) => setTimeout(r, fault.ms));

      let body = raw;
      if ((req.headers['content-type'] ?? '').includes('application/json') && raw !== '') {
        try {
          body = JSON.parse(raw);
        } catch {
          return send(res, 400, { error: 'invalid JSON body' });
        }
      }
      const record = {
        id: randomUUID(),
        receivedAt: new Date().toISOString(),
        path: url.pathname,
        body,
      };
      store(record);
      return send(res, 200, { id: record.id });
    } catch (error) {
      return send(res, error.status ?? 500, { error: error.message });
    }
  });

  // Held "timeout" requests would keep close() waiting forever.
  const close = () =>
    new Promise((resolve) => {
      for (const res of held) res.destroy();
      server.close(() => resolve());
    });

  return { server, close, settle: engine.settle };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.WHATSAPP_STUB_PORT ?? 8080);
  const host = process.env.WHATSAPP_STUB_HOST ?? '0.0.0.0';
  const logPath = process.env.WHATSAPP_STUB_LOG ?? join(tmpdir(), 'whatsapp-stub', 'sent.jsonl');
  const { server, close } = createStub({ logPath, engine: engineSettingsFromEnv(process.env) });
  server.listen(port, host, () => {
    console.log(`whatsapp-stub listening on ${host}:${port}, log ${logPath}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => close().then(() => process.exit(0)));
  }
}
