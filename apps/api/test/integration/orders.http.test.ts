import { randomBytes } from 'node:crypto';
import type { Order } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { StubGeocoder } from '../../src/modules/kernel/geocoding/stub-geocoder.js';
import { ProviderFailure } from '../../src/modules/kernel/outbox/provider-failure.js';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { insertAccount } from './identity-fixtures.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';
import { plantSite } from './zone-fixtures.js';

// DEL-2 item B over HTTP (plan 2.3 to 2.6, 2.11 create cases): an order of each kind numbered per
// account; the address located by a sent point, the short code, or the text with its city at or
// above 0.6, else `needs_location` (below the threshold, not found, a geocoder outage); the zone
// from the site's coverage, else `outside_coverage`; the intake rule; the first event, the audit
// row and the outbox row without recipient data; an idempotent replay; twenty parallel creates
// numbered consecutively; the refusals (COD by kind, site kind and state, slot, the monthly
// limit, the permission).

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `orders:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'orders',
  TRUST_PROXY_HOPS: '1',
  GEOCODER_SOURCES: 'stub',
});

const createOp = operationSchemas.createOrder;
const errorOf = (body: unknown) => createOp.responses['4XX'].parse(body);

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

/** Al Olaya in the geocoder fixture (short code REMA7572). */
const olaya = { lat: 24.695, lng: 46.685 };
/** Al Rawdah, Jeddah: outside every zone of these tests. */
const jeddah = { lat: 21.5, lng: 39.2 };

describe('createOrder over HTTP (DEL-2 item B)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await staff?.close();
    await owner?.end();
  });

  /**
   * An account with a branch covering Al Olaya (a 4 km square), the intake rule and the monthly
   * order limit given, and a dispatcher.
   */
  async function world(
    options: { rule?: 'auto_accept' | 'receive_as_pending'; limit?: number } = {},
  ) {
    const accountId = await insertAccount(owner);
    await owner`
      UPDATE core_accounts
      SET settings = ${owner.json({ intake_rule: options.rule ?? 'receive_as_pending', max_attempts: 4 })},
          limits = ${owner.json(options.limit === undefined ? {} : { orders_per_month: options.limit })}
      WHERE id = ${accountId}`;
    const siteId = await plantSite(owner, accountId, 'branch');
    const zoneId = uuidv7();
    await owner`
      INSERT INTO del_zones (id, account_id, name_ar, name_en, boundary, source)
      VALUES (${zoneId}, ${accountId}, 'العليا', 'Olaya',
              ST_GeomFromText('MULTIPOLYGON(((46.66 24.68, 46.7 24.68, 46.7 24.72, 46.66 24.72, 46.66 24.68)))', 4326),
              'drawn')`;
    await owner`
      INSERT INTO del_coverage (id, account_id, site_id, zone_id)
      VALUES (${uuidv7()}, ${accountId}, ${siteId}, ${zoneId})`;
    const dispatcher = await staff.member(accountId, ['dispatcher']);
    return { accountId, siteId, zoneId, dispatcher };
  }

  const orderBody = (siteId: string, overrides: Record<string, unknown> = {}) => ({
    kind: 'delivery',
    site_id: siteId,
    recipient: { name: 'سارة القحطاني', phone: '+966500000123', preferred_language: 'ar' },
    address: { text: 'شارع العليا', city: 'الرياض', point: olaya },
    items: [{ name_ar: 'قميص', name_en: 'Shirt', quantity: 2, sku: 'SH-1' }],
    ...overrides,
  });

  const post = (member: SignedInMember, body: object, key = nextKey()) =>
    staff
      .http()
      .post('/v1/staff/orders')
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Accept-Language', 'en')
      .set('Idempotency-Key', key)
      .send(body);
  const created = async (member: SignedInMember, body: object): Promise<Order> =>
    createOp.responses['201'].parse((await post(member, body).expect(201)).body);

  it('creates an order of each kind, numbered per account, with its event, audit and outbox rows', async () => {
    const { accountId, siteId, zoneId, dispatcher } = await world();
    const response = await post(
      dispatcher,
      orderBody(siteId, {
        cod_amount: { amount: 15_000 },
        notes: 'الباب الخلفي',
        source_ref: 'SO-1',
      }),
    ).expect(201);
    const order = createOp.responses['201'].parse(response.body) as Order;
    expect(order).toMatchObject({
      number: 'D-000001',
      kind: 'delivery',
      status: 'pending',
      pending_reason: null,
      site_id: siteId,
      source: 'manual',
      source_ref: 'SO-1',
      recipient: { name: 'سارة القحطاني', phone: '+966500000123', preferred_language: 'ar' },
      address: {
        text: 'شارع العليا',
        city: 'الرياض',
        point: olaya,
        pin_source: 'manual',
        geocode_confidence: 1,
      },
      zone_id: zoneId,
      slot_id: null,
      cod_amount: { amount: 15_000, currency: 'SAR' },
      current_assignment_id: null,
      attempt_count: 0,
      max_attempts: 4,
      notes: 'الباب الخلفي',
      version: 1,
    });
    expect(order.items).toEqual([
      expect.objectContaining({
        name_ar: 'قميص',
        name_en: 'Shirt',
        sku: 'SH-1',
        quantity: 2,
        direction: 'out',
      }),
    ]);
    expect(response.body).not.toHaveProperty('executor_account_id');

    const events = await owner<
      {
        type: string;
        from_status: string | null;
        to_status: string;
        actor_type: string;
        actor_id: string;
        idempotency_key: string;
      }[]
    >`SELECT type, from_status, to_status, actor_type, actor_id, idempotency_key
      FROM del_order_events WHERE order_id = ${order.id}`;
    expect(events.map((row) => ({ ...row }))).toEqual([
      {
        type: 'transition',
        from_status: null,
        to_status: 'pending',
        actor_type: 'user',
        actor_id: dispatcher.userId,
        idempotency_key: `00000000-0000-4000-8000-${String(keySequence).padStart(12, '0')}`,
      },
    ]);

    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit.map((row) => row.action)).toEqual(['delivery.order.created']);
    expect(audit[0]).toMatchObject({ accountId, actorId: dispatcher.userId, targetId: order.id });
    expect(audit[0]?.after).toEqual({
      number: 1,
      kind: 'delivery',
      site_id: siteId,
      status: 'pending',
      pending_reason: null,
      item_count: 1,
      cod_amount: 15_000,
    });
    const [outbox] = await owner<
      { type: string; kind: string; payload: Record<string, unknown> }[]
    >`
      SELECT type, kind, payload FROM core_outbox WHERE aggregate_id = ${order.id}`;
    expect(outbox).toMatchObject({ type: 'delivery.order.created', kind: 'internal_event' });
    expect(outbox?.payload).toEqual({
      order_id: order.id,
      number: 1,
      kind: 'delivery',
      source: 'manual',
      site_id: siteId,
      status: 'pending',
      pending_reason: null,
      zone_id: zoneId,
      cod_amount: { amount: 15_000, currency: 'SAR' },
    });
    // No recipient data in the audit row, the outbox payload or the event (data §3.1, §10).
    for (const document of [audit[0]?.after, outbox?.payload, events]) {
      const text = JSON.stringify(document);
      expect(text).not.toContain('سارة');
      expect(text).not.toContain('500000123');
      expect(text).not.toContain('العليا');
    }

    const items = [
      { name_ar: 'حذاء', name_en: 'Shoes', quantity: 1, direction: 'out' },
      { name_ar: 'قميص', name_en: 'Shirt', quantity: 1, direction: 'in' },
    ];
    const exchange = await created(dispatcher, orderBody(siteId, { kind: 'exchange', items }));
    expect(exchange.number).toBe('D-000002');
    expect(exchange.items?.map((item) => item.direction)).toEqual(['out', 'in']);
    for (const [kind, number] of [
      ['return_pickup', 'D-000003'],
      ['pickup_request', 'D-000004'],
    ] as const) {
      const order = await created(dispatcher, orderBody(siteId, { kind, items }));
      expect(order).toMatchObject({ kind, number, cod_amount: { amount: 0, currency: 'SAR' } });
      expect(order.items?.map((item) => item.direction)).toEqual(['in', 'in']);
    }
    // Another account starts at 1.
    const other = await world();
    expect((await created(other.dispatcher, orderBody(other.siteId))).number).toBe('D-000001');
  });

  it('locates by short code, by text at or above 0.6, and leaves the rest needs_location', async () => {
    const { siteId, zoneId, dispatcher } = await world();
    const address = (fields: Record<string, unknown>) =>
      created(dispatcher, orderBody(siteId, { address: fields }));

    const byCode = await address({
      text: 'Somewhere',
      city: 'Riyadh',
      national_address_short_code: 'REMA7572',
    });
    expect(byCode).toMatchObject({
      status: 'pending',
      pending_reason: null,
      zone_id: zoneId,
      address: { point: olaya, pin_source: 'geocoded', geocode_confidence: 1 },
    });
    const byText = await address({ text: 'Al Olaya district', city: 'Riyadh' });
    expect(byText).toMatchObject({
      pending_reason: null,
      zone_id: zoneId,
      address: { point: olaya, pin_source: 'geocoded', geocode_confidence: 0.8 },
    });
    // Al Hamra is in both cities and the city names both: 0.5, below the threshold.
    const ambiguous = await address({ text: 'Al Hamra', city: 'Riyadh Jeddah' });
    const notFound = await address({ text: 'Nowhere Street', city: 'Riyadh' });
    for (const order of [ambiguous, notFound]) {
      expect(order).toMatchObject({
        status: 'pending',
        pending_reason: 'needs_location',
        zone_id: null,
      });
      expect(order.address).not.toHaveProperty('point');
      expect(order.address).not.toHaveProperty('pin_source');
    }

    // A geocoder outage never fails the create (plan 2.4).
    const spy = vi
      .spyOn(StubGeocoder.prototype, 'geocode')
      .mockRejectedValueOnce(new ProviderFailure('transient', 'geocoder down'));
    const outage = await address({ text: 'Al Malaz', city: 'Riyadh' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(outage).toMatchObject({
      status: 'pending',
      pending_reason: 'needs_location',
      zone_id: null,
    });
  });

  it('applies the coverage and the intake rule (D-3)', async () => {
    const pending = await world({ rule: 'receive_as_pending' });
    const auto = await world({ rule: 'auto_accept' });
    expect(await created(auto.dispatcher, orderBody(auto.siteId))).toMatchObject({
      status: 'accepted',
      pending_reason: null,
      zone_id: auto.zoneId,
    });
    const autoEvent = await owner<{ to_status: string }[]>`
      SELECT e.to_status FROM del_order_events e JOIN del_orders o ON o.id = e.order_id
      WHERE o.account_id = ${auto.accountId}`;
    expect(autoEvent.map((row) => row.to_status)).toEqual(['accepted']);
    for (const w of [pending, auto]) {
      const outside = await created(
        w.dispatcher,
        orderBody(w.siteId, { address: { text: 'Al Rawdah', city: 'Jeddah', point: jeddah } }),
      );
      expect(outside).toMatchObject({
        status: 'pending',
        pending_reason: 'outside_coverage',
        zone_id: null,
        address: { point: jeddah, pin_source: 'manual' },
      });
    }
    // A site that covers nothing leaves even Al Olaya outside its coverage.
    const bare = await plantSite(owner, auto.accountId, 'both');
    expect(await created(auto.dispatcher, orderBody(bare))).toMatchObject({
      status: 'pending',
      pending_reason: 'outside_coverage',
      zone_id: null,
    });
  });

  it('answers a replay with the original order and numbers twenty parallel creates consecutively', async () => {
    const { accountId, siteId, dispatcher } = await world();
    const key = nextKey();
    const first = await post(dispatcher, orderBody(siteId), key).expect(201);
    const replay = await post(dispatcher, orderBody(siteId), key).expect(201);
    expect(replay.body).toEqual(first.body);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => post(dispatcher, orderBody(siteId))),
    );
    expect(responses.map((response) => response.status)).toEqual(Array(20).fill(201));
    const numbers = responses
      .map((response) => (createOp.responses['201'].parse(response.body) as Order).number)
      .sort();
    expect(numbers).toEqual(
      Array.from({ length: 20 }, (_, index) => `D-${String(index + 2).padStart(6, '0')}`),
    );
    const [count] = await owner<{ n: number; max: string }[]>`
      SELECT count(*)::int AS n, max(number)::text AS max FROM del_orders WHERE account_id = ${accountId}`;
    expect(count).toEqual({ n: 21, max: '21' });
  });

  it('refuses COD by kind, a bad site, a slot, the month past its limit and a viewer', async () => {
    const { accountId, siteId, dispatcher } = await world({ limit: 1 });
    const refused = async (body: object, status: number) =>
      errorOf((await post(dispatcher, body).expect(status)).body);

    expect(
      await refused(orderBody(siteId, { kind: 'return_pickup', cod_amount: { amount: 100 } }), 422),
    ).toMatchObject({
      code: 'cod_not_allowed',
      details: { kind: 'return_pickup', cod_amount: 100 },
    });
    const warehouse = await plantSite(owner, accountId, 'warehouse');
    expect(await refused(orderBody(warehouse), 422)).toMatchObject({ code: 'site_kind_mismatch' });
    const inactive = await plantSite(owner, accountId, 'branch', 'inactive');
    const foreign = await plantSite(owner, await insertAccount(owner), 'branch');
    for (const site of [inactive, foreign]) {
      expect((await refused(orderBody(site), 400)).details).toMatchObject({
        fields: [expect.objectContaining({ pointer: '/body/site_id', code: 'invalid' })],
      });
    }
    expect((await refused(orderBody(siteId, { slot_id: uuidv7() }), 400)).details).toMatchObject({
      fields: [expect.objectContaining({ pointer: '/body/slot_id' })],
    });
    // None of the refusals took a number or counted an order.
    const [usage] = await owner<{ value: number }[]>`
      SELECT coalesce(sum(value), 0)::int AS value FROM core_usage_counters
      WHERE account_id = ${accountId} AND metric = 'orders'`;
    expect(usage?.value).toBe(0);

    expect((await created(dispatcher, orderBody(siteId))).number).toBe('D-000001');
    expect(await refused(orderBody(siteId), 422)).toMatchObject({
      code: 'limit_exceeded',
      details: { metric: 'orders_per_month', limit: 1 },
    });
    // The refused one gave its number back.
    const [sequence] = await owner<{ next_value: string }[]>`
      SELECT next_value::text FROM core_sequences WHERE account_id = ${accountId}`;
    expect(sequence?.next_value).toBe('2');

    const viewer = await staff.member(accountId, ['viewer']);
    expect(errorOf((await post(viewer, orderBody(siteId)).expect(403)).body).code).toBe(
      'forbidden',
    );
  });
});
