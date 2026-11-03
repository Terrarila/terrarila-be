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
        `SELECT to_regclass('materials') IS NOT NULL
        AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='site_content' AND column_name='revision')
        AND to_regclass('media_upload_intents') IS NOT NULL
        AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('admin_audit_log') AND tgname='admin_audit_append_only' AND tgenabled<>'D') AS initialized`,
      );
      if (!result.rows[0]?.initialized) throw new Error('Schema missing');
      return { status: 'ok', database: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Database not ready');
    }
  }
}
