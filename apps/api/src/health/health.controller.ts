import { Controller, Get } from '@nestjs/common';

/** Liveness probe (platform §5); it touches no dependency. Readiness is `ReadyController`. */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
