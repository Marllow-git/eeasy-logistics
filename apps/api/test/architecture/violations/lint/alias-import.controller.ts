// Violation fixture (re-check M-6): a raw decorator imported under another name.
import { Controller, Post, Body as Payload } from '@nestjs/common';

@Controller('v1/staff/alias-import')
export class AliasImportController {
  @Post()
  create(@Payload() body: unknown): unknown {
    return body;
  }
}
