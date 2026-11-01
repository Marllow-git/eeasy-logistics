// The repository lint rules of document 3 §9 (PLAT-15 item A): a clean fixture passes, and each
// planted defect fails with the rule that owns it. The rules come from docs/contracts/redocly.yaml
// itself; only `apis` is swapped for the fixture.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const run = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '..');
const contractsDir = resolve(packageRoot, '../../docs/contracts');
const redocly = resolve(packageRoot, 'node_modules/.bin/redocly');
const work = mkdtempSync(join(tmpdir(), 'plat15-lint-'));

afterAll(() => rmSync(work, { recursive: true, force: true }));

type Doc = Record<string, unknown>;

/** A minimal valid surface: one write with the key, one read, one stream. */
function cleanDoc(): Doc {
  const errorResponse = {
    description: 'Error',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Fixture',
      version: '1.0.0',
      license: { name: 'UNLICENSED', identifier: 'UNLICENSED' },
    },
    servers: [{ url: 'https://example.test/v1/staff' }],
    security: [{ cookie: [] }],
    paths: {
      '/things': {
        get: {
          operationId: 'listThings',
          summary: 'List things',
          tags: ['things'],
          'x-wave': 0,
          'x-permission': 'core.sites.read',
          responses: { '200': { description: 'OK' }, '4XX': errorResponse },
        },
        post: {
          operationId: 'createThing',
          summary: 'Create a thing',
          tags: ['things'],
          'x-wave': 1,
          'x-permission': 'core.sites.manage',
          parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
          responses: { '201': { description: 'Created' }, '4XX': errorResponse },
        },
      },
      '/stream': {
        get: {
          operationId: 'streamThings',
          summary: 'Stream things',
          tags: ['things'],
          'x-wave': 1,
          'x-permission': 'core.sites.read',
          'x-sse-events': ['delivery.order.*', 'stream.resync'],
          responses: {
            '200': {
              description: 'Stream',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
            '4XX': errorResponse,
          },
        },
      },
    },
    components: {
      securitySchemes: { cookie: { type: 'apiKey', in: 'cookie', name: 'el_at' } },
      parameters: {
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string' } },
        },
      },
    },
  };
}

type Op = Record<string, unknown>;
const paths = (doc: Doc) => doc.paths as Record<string, Record<string, Op>>;

/** Writes the fixture and a copy of the repository config pointing at it, then lints. */
async function lint(
  name: string,
  doc: Doc,
  apiName = 'staff',
): Promise<{ ok: boolean; out: string }> {
  const config = parse(readFileSync(join(contractsDir, 'redocly.yaml'), 'utf8')) as Doc;
  config.plugins = (config.plugins as string[]).map((p) => resolve(contractsDir, p));
  const rules = config.rules as Record<string, Record<string, unknown>>;
  rules['eeasy/permission-in-catalogue']!.catalogue = join(contractsDir, 'permissions.yaml');
  // Keep the surface's own rule overrides (platform allows x-cross-tenant).
  const apis = config.apis as Record<string, Doc>;
  config.apis = { [apiName]: { ...apis[apiName], root: `${name}.yaml` } };
  writeFileSync(join(work, `${name}.yaml`), stringify(doc));
  writeFileSync(join(work, `${name}.redocly.yaml`), stringify(config));
  try {
    const { stdout, stderr } = await run(
      redocly,
      ['lint', '--config', `${name}.redocly.yaml`, '--format', 'codeframe'],
      { cwd: work },
    );
    return { ok: true, out: stdout + stderr };
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    return { ok: false, out: stdout + stderr };
  }
}

describe('contract lint rules (document 3 §9)', () => {
  it('passes a clean surface', async () => {
    const result = await lint('clean', cleanDoc());
    expect(result.out).toContain('valid');
    expect(result.ok).toBe(true);
  });

  it('fails a write without Idempotency-Key', async () => {
    const doc = cleanDoc();
    delete paths(doc)['/things']!.post!.parameters;
    const result = await lint('no-key', doc);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('eeasy/idempotency-key');
  });

  it('accepts a write without the key when its operationId is exempt', async () => {
    const doc = cleanDoc();
    const post = paths(doc)['/things']!.post!;
    delete post.parameters;
    post.operationId = 'login';
    expect((await lint('exempt', doc)).ok).toBe(true);
  });

  it('fails a permission outside the catalogue', async () => {
    const doc = cleanDoc();
    paths(doc)['/things']!.get!['x-permission'] = 'core.sitez.read';
    const result = await lint('bad-permission', doc);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('eeasy/permission-in-catalogue');
  });

  it('fails a dangling $ref', async () => {
    const doc = cleanDoc();
    paths(doc)['/things']!.get!.responses = {
      '200': { $ref: '#/components/responses/Missing' },
      '4XX': { description: 'Error' },
    };
    const result = await lint('dangling-ref', doc);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('no-unresolved-refs');
  });

  it('fails x-wave outside 0 to 4', async () => {
    const doc = cleanDoc();
    paths(doc)['/things']!.get!['x-wave'] = 5;
    const result = await lint('bad-wave', doc);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('eeasy/x-wave-range');
  });

  it('fails x-cross-tenant outside the platform surface and accepts it on platform', async () => {
    const doc = cleanDoc();
    paths(doc)['/things']!.get!['x-cross-tenant'] = true;
    const result = await lint('cross-tenant', doc);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('rule/operation-x-cross-tenant-platform-only');
    expect((await lint('cross-tenant-platform', doc, 'platform')).ok).toBe(true);
  });

  it('fails a stream without x-sse-events', async () => {
    const doc = cleanDoc();
    delete paths(doc)['/stream']!.get!['x-sse-events'];
    const result = await lint('no-events', doc);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('eeasy/sse-events');
  });
});
