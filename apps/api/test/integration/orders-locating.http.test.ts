import { randomBytes } from 'node:crypto';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { findContext } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { notFound } from '../../src/modules/kernel/geocoding/geocoder.js';
import { StubGeocoder } from '../../src/modules/kernel/geocoding/stub-geocoder.js';
import { defaultBudgets, namedBudgets } from '../../src/modules/kernel/rate-limit/budgets.js';
import {
  RATE_LIMITER,
  RateLimiter,
  redisRateLimitStore,
} from '../../src/modules/kernel/rate-limit/rate-limiter.js';
import { testSigningKey } from '../support/access-tokens.js';
import { createOrder, nextKey, olaya, orderBody, orderWorld } from './order-fixtures.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// DEL-2 adversary round 1, lead ruling 1: the order doors locate the address before the request's
// unit of work (a route guard ahead of the unit-of-work and idempotency interceptors), so no app
// connection waits on the geocoder, and the lookup is capped at 2 s. With a pool of four and a
// geocoder that takes 2 s, six parallel creates finish in about one lookup's time and none of the
// lookups runs inside a tenant transaction (before the fix each held a connection for the whole
// lookup: four ran, two queued for a connection, and every other tenant's request with them).

const signing = testSigningKey();
const poolSize = 4;
const small = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `orders-locating:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'orders-locating',
  TRUST_PROXY_HOPS: '1',
  GEOCODER_SOURCES: 'stub',
  DATABASE_POOL_SIZE_APP: String(poolSize),
});

const createOp = operationSchemas.createOrder;
const updateOp = operationSchemas.updateOrder;

describe('the order doors locate before the transaction (DEL-2 adversary round 1, ruling 1)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;

  beforeAll(async () => {
    owner = connectAs('owner', small);
    staff = await startStaffApp(small, owner);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await staff?.close();
    await owner?.end();
  });

  /** A geocoder that answers after `delayMs`, noting whether each call ran in a tenant context. */
  const slowGeocoder = (delayMs: number) => {
    const inContext: boolean[] = [];
    const spy = vi.spyOn(StubGeocoder.prototype, 'geocode').mockImplementation(async () => {
      inContext.push(findContext() !== undefined);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return notFound;
    });
    return { inContext, spy };
  };

  const post = (member: SignedInMember, body: object) =>
    staff
      .http()
      .post('/v1/staff/orders')
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', nextKey())
      .send(body);

  it('runs six parallel creates with a 2 s geocoder on a pool of four without starving it', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const { inContext, spy } = slowGeocoder(2_000);
    const body = orderBody(siteId, { address: { text: 'Al Malaz', city: 'Riyadh' } });

    const started = Date.now();
    const answers = await Promise.all(Array.from({ length: 6 }, () => post(dispatcher, body)));
    const elapsed = Date.now() - started;

    expect(answers.map((answer) => answer.status)).toEqual(Array(6).fill(201));
    for (const answer of answers) {
      expect(createOp.responses['201'].parse(answer.body)).toMatchObject({
        status: 'pending',
        pending_reason: 'needs_location',
      });
    }
    expect(spy).toHaveBeenCalledTimes(6);
    expect(inContext).toEqual(Array(6).fill(false));
    // One lookup's time (capped at 2 s) plus six short transactions, not two rounds of lookups.
    expect(elapsed).toBeLessThan(3_500);
  });

  it('locates an address edit before the transaction too', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(
      staff,
      dispatcher,
      orderBody(siteId, { address: { text: 'شارع العليا', city: 'الرياض' } }),
    );
    const { inContext, spy } = slowGeocoder(50);
    const response = await staff
      .http()
      .patch(`/v1/staff/orders/${order.id}`)
      .set(staff.writeHeaders())
      .set('Cookie', dispatcher.cookie)
      .set('Idempotency-Key', nextKey())
      .set('If-Match', `"${order.version}"`)
      .send({ address: { text: 'Al Malaz', city: 'Riyadh' } })
      .expect(200);
    expect(updateOp.responses['200'].parse(response.body)).toMatchObject({
      pending_reason: 'needs_location',
      version: 2,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(inContext).toEqual([false]);
  });
});

// Lead ruling 2: every lookup of the order doors is charged to the account's hourly budget
// (`geocode_account`, 300 an hour; 2 here) before a provider is asked. Past it the create lands
// `needs_location` and an address edit keeps the order's point, with no provider call. An edit
// whose text, city, district and short code are unchanged asks nothing at all.
describe("the order doors' geocoder budget (DEL-2 adversary round 1, ruling 2)", () => {
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
    CREDENTIALS_KEYS: `orders-budget:${randomBytes(32).toString('base64')}`,
    CREDENTIALS_ACTIVE_KEY_ID: 'orders-budget',
    TRUST_PROXY_HOPS: '1',
    GEOCODER_SOURCES: 'stub',
  });
  let staff: StaffApp;
  let owner: postgres.Sql;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    const redisUrl = config.redis.url?.reveal() ?? '';
    const limiter = new RateLimiter(redisRateLimitStore(redisUrl), {
      prefix: `elx-test-budget-${randomBytes(4).toString('hex')}:rl`,
      budgets: {
        ...defaultBudgets,
        named: { ...namedBudgets, geocode_account: { limit: 2, windowMs: 3_600_000 } },
      },
    });
    staff = await startStaffApp(config, owner, {
      configure: (builder) => builder.overrideProvider(RATE_LIMITER).useValue(limiter),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await staff?.close();
    await owner?.end();
  });

  const patch = (member: SignedInMember, id: string, version: number, body: object) =>
    staff
      .http()
      .patch(`/v1/staff/orders/${id}`)
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', nextKey())
      .set('If-Match', `"${version}"`)
      .send(body)
      .expect(200)
      .then((response) => updateOp.responses['200'].parse(response.body));

  const byText = { text: 'Al Olaya district', city: 'Riyadh' };

  it('takes the create without a point and keeps the edited order on its point past the budget', async () => {
    const { siteId, zoneId, dispatcher } = await orderWorld(owner, staff);
    const spy = vi.spyOn(StubGeocoder.prototype, 'geocode');
    const first = await createOrder(staff, dispatcher, orderBody(siteId, { address: byText }));
    await createOrder(staff, dispatcher, orderBody(siteId, { address: byText }));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(first).toMatchObject({ zone_id: zoneId, address: { point: olaya } });

    const third = await createOrder(staff, dispatcher, orderBody(siteId, { address: byText }));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(third).toMatchObject({ status: 'pending', pending_reason: 'needs_location' });
    expect(third.address).not.toHaveProperty('point');

    const edited = await patch(dispatcher, first.id, 1, {
      address: { text: 'Al Malaz', city: 'Riyadh' },
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(edited).toMatchObject({
      zone_id: zoneId,
      version: 2,
      address: { text: 'Al Malaz', point: olaya, pin_source: 'geocoded' },
    });
  });

  it('asks nothing for an edit that leaves the address as it was', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(staff, dispatcher, orderBody(siteId, { address: byText }));
    const spy = vi.spyOn(StubGeocoder.prototype, 'geocode');
    const edited = await patch(dispatcher, order.id, 1, { address: byText, notes: 'gate 3' });
    expect(spy).not.toHaveBeenCalled();
    expect(edited).toMatchObject({ version: 2, notes: 'gate 3', address: { point: olaya } });
  });
});
