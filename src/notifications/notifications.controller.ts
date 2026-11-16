import { Controller, Get, Header, Headers, Inject, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { CONFIG } from '../common/config.js';
import type { AppConfig } from '../common/config.js';
import { NotificationsService } from './notifications.service.js';

@Controller('v1/maintenance/notifications')
export class NotificationsController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async drain(@Headers('authorization') authorization?: string) {
    const expected = Buffer.from(`Bearer ${this.config.cronSecret ?? ''}`);
    const actual = Buffer.from(authorization ?? '');
    if (
      !this.config.cronSecret ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new UnauthorizedException();
    return this.notifications.drain();
  }
}
