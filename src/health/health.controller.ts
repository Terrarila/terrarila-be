import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service.js';
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    try {
      const result = await this.db.query<{ initialized: boolean }>(
        `SELECT to_regclass('materials') IS NOT NULL AS initialized`,
      );
      if (!result.rows[0]?.initialized) throw new Error('Schema missing');
      return { status: 'ok', database: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Database not ready');
    }
  }
}
