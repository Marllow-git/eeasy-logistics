import type { Config } from '@eeasy-logistics/config';
import type { NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { engineCallbackPath } from './modules/kernel/messaging/engine/envelope.js';

/**
 * Options for `NestFactory.create` (adversary H-1): Nest's default parsers are off, so no
 * urlencoded or text body is ever parsed; `configureHttp` registers the JSON parser alone.
 */
export const httpAppOptions: NestApplicationOptions = { bodyParser: false };

/**
 * The Express instance of the API process (`--role api`). Routing settings must exist before
 * Express creates its router, which it does on the first `use()`, so they are set here, before
 * Nest touches the instance:
 *
 * - `case sensitive routing` and `strict routing` (adversary H-1): `/V1/STAFF/...` and a trailing
 *   slash match no route, so a path can never reach a handler under a spelling the surface rules
 *   do not recognise.
 * - `trust proxy` is the number of reverse-proxy hops whose `X-Forwarded-For` entries are believed
 *   (PLAT-6 review round 2; platform §8): 0 locally, 1 behind Cloudflare, whose ranges are the only
 *   ones the origin accepts. `request.ip`, the key of the anonymous rate-limit budget, is then the
 *   client the edge saw; a caller cannot push an address deeper than the configured depth.
 */
export function createHttpAdapter(config: Config): ExpressAdapter {
  const instance = express();
  instance.set('case sensitive routing', true);
  instance.set('strict routing', true);
  instance.set('trust proxy', config.app.trustProxyHops);
  return new ExpressAdapter(instance);
}

/**
 * After creation, before `init()`/`listen()`: JSON is the only body format (contracts §3). The
 * engine's callback door is the one path the parser leaves alone (PLAT-9 plan 2A.2): its handler
 * verifies the signature from the headers first and only then reads the raw body, bounded, to check
 * its hash (engine contract §2.3).
 */
export function configureHttp(app: NestExpressApplication): void {
  const json = express.json();
  app.use((request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (request.path === engineCallbackPath) {
      next();
      return;
    }
    json(request, response, next);
  });
}
