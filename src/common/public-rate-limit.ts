import { HttpException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { auditContext } from './audit-context.js';

@Injectable()
export class PublicRateLimit {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async consume(scope: string, token: string, limit: number, seconds: number) {
    const ip = auditContext.getStore()?.ipHash ?? 'unknown';
    for (const identity of [`ip:${ip}`, `guest:${token}`]) {
      const key = createHash('sha256').update(`${scope}:${identity}`).digest('hex');
      const result = await this.db.query(
        `INSERT INTO public_request_limits(key_hash,attempts,expires_at)
         VALUES($1,1,now()+make_interval(secs=>$3))
         ON CONFLICT(key_hash) DO UPDATE SET
           attempts=CASE WHEN public_request_limits.expires_at<=now() THEN 1 ELSE public_request_limits.attempts+1 END,
           expires_at=CASE WHEN public_request_limits.expires_at<=now() THEN now()+make_interval(secs=>$3) ELSE public_request_limits.expires_at END
         WHERE public_request_limits.expires_at<=now() OR public_request_limits.attempts<$2
         RETURNING key_hash`,
        [key, limit, seconds],
      );
      if (!result.rows.length)
        throw new HttpException({ code: 'RATE_LIMITED', message: 'Please try again later' }, 429);
    }
  }
}
