// Strict operation schemas, the operationId map and the seeded mocks (PLAT-15 plan 2.12, A-17).
import { describe, expect, it } from 'vitest';
import { bundleOperationIds, mapOperationSchemas } from '../scripts/operations.ts';
import { surfaces } from '../scripts/paths.ts';
import * as driverMocks from '../src/mocks/driver.ts';
import * as recipientMocks from '../src/mocks/recipient.ts';
import { operationSchemas as driverOperations } from '../src/driver.ts';
import { operationSchemas as platformOperations } from '../src/platform.ts';
import { operationSchemas as publicOperations } from '../src/public.ts';
import { operationSchemas as recipientOperations } from '../src/recipient.ts';
import { operationSchemas as staffOperations } from '../src/staff.ts';

const bySurface = {
  staff: staffOperations,
  platform: platformOperations,
  public: publicOperations,
  driver: driverOperations,
  recipient: recipientOperations,
};

const provision = {
  name: 'Acme Riyadh',
  default_locale: 'ar',
  limits: { drivers: 10 },
  owner: { email: 'owner@example.test', name: 'Owner' },
};

describe('operationSchemas', () => {
  it('holds every operation of every bundle, each with at least one response schema', () => {
    for (const { name } of surfaces) {
      const ids = bundleOperationIds(name);
      const map: Record<string, { responses: Record<string, unknown> }> = bySurface[name];
      expect(Object.keys(map).sort(), name).toEqual([...ids].sort());
      for (const id of ids) expect(Object.keys(map[id]?.responses ?? {}), id).not.toEqual([]);
    }
  });

  it('rejects an undeclared body field (account_id, K-3) and accepts the declared body', () => {
    const { body } = platformOperations.platformProvisionAccount;
    expect(body.safeParse(provision).success).toBe(true);
    const result = body.safeParse({
      ...provision,
      account_id: '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3e',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
    // Nested objects are strict too.
    expect(body.safeParse({ ...provision, owner: { ...provision.owner, role: 'x' } }).success).toBe(
      false,
    );
  });

  it('does not coerce the body', () => {
    const { body } = platformOperations.platformProvisionAccount;
    expect(body.safeParse({ ...provision, limits: { drivers: '10' } }).success).toBe(false);
  });

  it('coerces query strings: ?limit=50 is the number 50; undeclared query fields are refused', () => {
    const { query } = platformOperations.platformListAccounts;
    expect(query.parse({ limit: '50' }).limit).toBe(50);
    expect(query.safeParse({ limit: 'fifty' }).success).toBe(false);
    expect(query.safeParse({ limit: '50', account_id: 'x' }).success).toBe(false);
  });

  it('reads query booleans as words: false stays false (not Boolean("false"))', () => {
    const { query } = staffOperations.listZones;
    expect(query.parse({ active: 'false' }).active).toBe(false);
    expect(query.parse({ active: 'true' }).active).toBe(true);
    expect(query.safeParse({ active: 'maybe' }).success).toBe(false);
  });

  it('checks path parameters strictly (no contract path parameter is numeric yet)', () => {
    const { params } = platformOperations.platformGetAccount;
    const id = '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3e';
    expect(params.safeParse({ account_id: id }).success).toBe(true);
    expect(params.safeParse({ account_id: 'not-a-uuid' }).success).toBe(false);
    expect(params.safeParse({ account_id: id, id }).success).toBe(false);
  });

  it('keeps one response schema per documented status', () => {
    expect(Object.keys(platformOperations.platformLogin.responses).sort()).toEqual([
      '200',
      '401',
      '429',
      '4XX',
    ]);
  });
});

describe('mapOperationSchemas', () => {
  it('assigns by exact suffix, so a longer operationId never steals a shorter one', () => {
    const map = mapOperationSchemas(
      ['getAccount', 'getAccountOrder'],
      ['GetAccountParams', 'GetAccountOrderParams', 'GetAccount200Response', 'getAccountQMax'],
    );
    expect(map).toEqual({
      getAccount: { params: 'GetAccountParams', responses: { '200': 'GetAccount200Response' } },
      getAccountOrder: { params: 'GetAccountOrderParams', responses: {} },
    });
  });

  it('fails on a schema no operation owns', () => {
    expect(() => mapOperationSchemas(['a'], ['BSomethingBody'])).toThrow('matches no operation');
  });
});

describe('mocks entry points', () => {
  it('exist for driver and recipient, with handlers and seeded factories', () => {
    expect(driverMocks.getEeasyLogisticsDriverAPIMock().length).toBeGreaterThan(0);
    expect(Object.keys(recipientMocks).some((name) => name.endsWith('Mock'))).toBe(true);
    driverMocks.seedMocks(7);
    const first = driverMocks.getDriverRefreshResponseMock();
    driverMocks.seedMocks(7);
    expect(driverMocks.getDriverRefreshResponseMock()).toEqual(first);
  });
});
