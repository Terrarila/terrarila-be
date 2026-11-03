import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../auth/session.guard.js';
import { AdminGuard } from './admin.guard.js';
import { Operations } from '../common/operations.js';
import { CONFIG } from '../common/config.js';
import type { AppConfig } from '../common/config.js';
@ApiTags('Admin operations')
@ApiBearerAuth()
@UseGuards(SessionGuard, AdminGuard)
@Controller('v1/admin/operations')
export class OperationsController {
  constructor(
    @Inject(Operations) private readonly operations: Operations,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}
  @Get('metrics') metrics() {
    return this.operations.snapshot(this.config.mediaRoot, this.config.backupDir);
  }
}
