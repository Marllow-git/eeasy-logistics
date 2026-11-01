// Violation fixture (re-check M-6): a controller declared in a file that is not *.controller.ts,
// where the controller input rules would not apply.
import { Controller, Get } from '@nestjs/common';

@Controller('v1/staff/hidden')
export class HiddenController {
  @Get()
  read(): string {
    return 'hidden';
  }
}
