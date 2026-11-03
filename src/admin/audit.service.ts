import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { auditChanges } from '../common/audit-context.js';
@Injectable()
export class AuditService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async security(action: string, actor: string, details: object) {
    try {
      await this.db.query(
        `INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes)
        VALUES($1,$2,'00000000-0000-4000-8000-000000000000',$3::jsonb)`,
        [actor, action, auditChanges(details)],
      );
    } catch {
      // Logging failure must be visible, and must not turn an auth rejection into success.
      Logger.error({ event: 'security_audit_failed', action }, 'Audit');
    }
  }
}
