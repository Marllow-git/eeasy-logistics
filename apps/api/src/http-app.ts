import type { Config } from '@eeasy-logistics/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Express settings of the API process (`--role api`). `trust proxy` is the number of reverse-proxy
 * hops whose `X-Forwarded-For` entries are believed (PLAT-6 review round 2; platform §8): 0
 * locally, 1 behind Cloudflare, whose ranges are the only ones the origin accepts. `request.ip`,
 * the key of the anonymous rate-limit budget, is then the client the edge saw; a caller cannot
 * push an address deeper than the configured depth.
 */
export function configureHttp(app: NestExpressApplication, config: Config): void {
  app.set('trust proxy', config.app.trustProxyHops);
}
