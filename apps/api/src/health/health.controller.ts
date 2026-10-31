import { Controller, Get } from '@nestjs/common';

/** Liveness probe (platform §5). Readiness (`/ready`) is PLAT-5's. */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
