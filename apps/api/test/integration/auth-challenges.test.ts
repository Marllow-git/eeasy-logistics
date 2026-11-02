import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opaqueToken, tokenHash } from '../../src/modules/kernel/auth/tokens.js';
import { AuthChallengesRepository } from '../../src/modules/kernel/platform/auth-challenges.repository.js';
import { connectAs, integrationConfig, sqlState } from './support.js';

// PLAT-11 item B on the real database (plan 2.1, 2.3; A-26): a challenge is found only by its id and
// the hash of its secret together, of its own kind; expiry is on the database clock; the row lock
// makes a second consumer wait for the first; elx_app cannot read the table at all.

const config = integrationConfig();

describe('core_auth_challenges repository (PLAT-11 item B)', () => {
  let pool: Pool<PlatformDatabase>;
  let owner: postgres.Sql;
  let app: postgres.Sql;
  let userId: string;

  const run = <T>(fn: (repo: AuthChallengesRepository) => Promise<T>) =>
    withPlatformUnitOfWork(pool.db, (uow) => fn(new AuthChallengesRepository(uow)));

  const fresh = async (ttlSeconds = 300, kind: 'selection' | 'second_factor' = 'selection') => {
    const id = uuidv7();
    const secret = opaqueToken();
    await run((repo) =>
      repo.insert({
        id,
        kind,
        userId,
        secretHash: tokenHash(secret),
        amr: ['pwd'],
        membershipIds: [uuidv7()],
        ttlSeconds,
        ip: '192.0.2.10',
      }),
    );
    return { id, secret };
  };

  beforeAll(async () => {
    pool = createPlatformPool(config.db, 'auth-challenges-test');
    owner = connectAs('owner', config);
    app = connectAs('app', config);
    userId = uuidv7();
    await owner`INSERT INTO core_users (id, name, email) VALUES (${userId}, 'Challenge User', ${`challenge-${userId}@example.test`})`;
  });

  afterAll(async () => {
    await pool.close();
    await owner.end();
    await app.end();
  });

  it('finds a challenge only by its id, the hash of its secret and its kind', async () => {
    const { id, secret } = await fresh();
    const found = await run((repo) => repo.lock(id, tokenHash(secret), 'selection'));
    expect(found).toMatchObject({
      id,
      kind: 'selection',
      userId,
      amr: ['pwd'],
      attempts: 0,
      consumed: false,
      expired: false,
    });
    expect(found?.membershipIds).toHaveLength(1);
    expect(
      await run((repo) => repo.lock(id, tokenHash(opaqueToken()), 'selection')),
    ).toBeUndefined();
    expect(
      await run((repo) => repo.lock(uuidv7(), tokenHash(secret), 'selection')),
    ).toBeUndefined();
    expect(await run((repo) => repo.lock(id, tokenHash(secret), 'second_factor'))).toBeUndefined();
  });

  it('reports expiry on the database clock and stores the secret only as its hash', async () => {
    const { id, secret } = await fresh(1);
    await owner`UPDATE core_auth_challenges SET expires_at = now() - interval '1 second' WHERE id = ${id}`;
    expect(await run((repo) => repo.lock(id, tokenHash(secret), 'selection'))).toMatchObject({
      expired: true,
    });
    const [row] = await owner<{ secret_hash: Buffer }[]>`
      SELECT secret_hash FROM core_auth_challenges WHERE id = ${id}`;
    expect(row?.secret_hash.equals(tokenHash(secret))).toBe(true);
    expect(row?.secret_hash.toString('utf8')).not.toContain(secret);
  });

  it('counts failures and marks consumption', async () => {
    const { id, secret } = await fresh();
    expect(await run((repo) => repo.recordFailure(id))).toBe(1);
    expect(await run((repo) => repo.recordFailure(id))).toBe(2);
    await run((repo) => repo.consume(id));
    expect(await run((repo) => repo.lock(id, tokenHash(secret), 'selection'))).toMatchObject({
      attempts: 2,
      consumed: true,
    });
  });

  it('makes a second locker wait until the first commits, then see the consumption', async () => {
    const { id, secret } = await fresh();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = run(async (repo) => {
      await repo.lock(id, tokenHash(secret), 'selection');
      order.push('first locked');
      await held;
      await repo.consume(id);
      order.push('first consumed');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = run(async (repo) => {
      const row = await repo.lock(id, tokenHash(secret), 'selection');
      order.push(`second saw consumed=${String(row?.consumed)}`);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first locked', 'first consumed', 'second saw consumed=true']);
  });

  it('gives elx_app no access to the table (users class, platform pool only)', async () => {
    expect(await sqlState(app`SELECT 1 FROM core_auth_challenges LIMIT 1`)).toBe('42501');
  });
});
