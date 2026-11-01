// Violation fixture (re-check M-6): `@Ip()`, one of the other raw parameter decorators.
import { Controller, Get, Ip } from '@nestjs/common';

@Controller('v1/staff/ip')
export class IpController {
  @Get()
  read(@Ip() ip: string): string {
    return ip;
  }
}
