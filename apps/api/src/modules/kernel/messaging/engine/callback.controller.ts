// eslint-disable-next-line no-restricted-imports -- the engine's signed callback door is not a contract operation: its envelope is verified from the headers before the raw body is read (plan 2A.2), which no ContractPipe input can do
import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../public/index.js';
import { EngineCallbackDoor } from './callback-door.js';

// `POST /internal/whatsapp/v1/callbacks` (PLAT-9 plan 2A.2; engine contract §1, §5): the path the
// engine compiles in (it posts to its configured base plus this path). Outside the five surfaces,
// `@Public()` (no token: the engine signs every callback) and answered by `EngineCallbackDoor`,
// which verifies the envelope before reading the body. The JSON parser skips this path
// (`configureHttp`), so the body stream is still unread here.

@Public()
@Controller('internal/whatsapp/v1')
export class EngineCallbackController {
  constructor(@Inject(EngineCallbackDoor) private readonly door: EngineCallbackDoor) {}

  @Post('callbacks')
  @HttpCode(200)
  async receive(
    // eslint-disable-next-line no-restricted-syntax -- the raw stream is read only after the signature passes (see the import)
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const answer = await this.door.receive({
      method: request.method,
      path: request.path,
      headers: request.headers,
      body: request,
    });
    response.status(answer.status).json(answer.body);
  }
}
