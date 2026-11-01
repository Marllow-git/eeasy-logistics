import type { Config } from '@eeasy-logistics/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { integrationConfig } from './support.js';

// /ready against the real stack (PLAT-5 item F): PostgreSQL as elx_app at the migrated version,
// Redis PING and storage HeadBucket (the ci profile in CI, the native stack locally).

describe('GET /ready on the real stack', () => {
  let app: INestApplication<App> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  const start = async (config: Config) => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    return request(app.getHttpServer());
  };

  it('answers 200 when the database, migrations, Redis and storage are ready', async () => {
    const http = await start(integrationConfig());
    await http.get('/ready').expect(200).expect({ status: 'ready' });
  });

  it('answers 503 naming redis when Redis does not answer', async () => {
    // Port 1 on loopback: nothing listens there, the connection is refused at once.
    const http = await start(integrationConfig({ REDIS_URL: 'redis://127.0.0.1:1' }));
    const response = await http.get('/ready').expect(503);
    expect(response.body).toEqual({ status: 'not_ready', failing: ['redis'] });
  });

  it('answers 503 naming database when the app URL logs in as another role (review M-6)', async () => {
    const platform = integrationConfig().db.urls.platform;
    expect(platform).toBeDefined();
    const http = await start(integrationConfig({ DATABASE_URL_APP: platform?.reveal() }));
    const response = await http.get('/ready').expect(503);
    expect(response.body).toEqual({ status: 'not_ready', failing: ['database'] });
  });

  it('answers 503 naming storage when the bucket does not exist', async () => {
    const http = await start(integrationConfig({ STORAGE_BUCKET: 'elx-missing-bucket' }));
    const response = await http.get('/ready').expect(503);
    expect(response.body).toEqual({ status: 'not_ready', failing: ['storage'] });
  });
});
