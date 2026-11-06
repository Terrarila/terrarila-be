import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { PublicRateLimit } from '../common/public-rate-limit.js';
import { decodeTimeCursor } from '../common/pagination.js';
import type { PageQuery } from '../common/pagination.js';
import type { FeedbackDto } from './feedback.dto.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class FeedbackService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PublicRateLimit) private readonly limiter: PublicRateLimit,
  ) {}
  async create(token: string, key: string, input: FeedbackDto) {
    const guest = hash(token);
    const fingerprint = hash(JSON.stringify({ email: input.email, message: input.message }));
    const existing = (
      await this.db.query(
        'SELECT id,request_hash FROM feedback WHERE guest_hash=$1 AND idempotency_key=$2',
        [guest, key],
      )
    ).rows[0];
    const replay = (row: Record<string, unknown>) => {
      if (row.request_hash !== fingerprint)
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Feedback changed' });
      return { id: row.id };
    };
    if (existing) return replay(existing);
    await this.limiter.consume('feedback', token, 5, 3600);
    return this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`feedback:${guest}`]);
      const saved = (
        await client.query(
          'SELECT id,request_hash FROM feedback WHERE guest_hash=$1 AND idempotency_key=$2',
          [guest, key],
        )
      ).rows[0];
      if (saved) return replay(saved);
      const id = randomUUID();
      await client.query(
        'INSERT INTO feedback(id,guest_hash,idempotency_key,request_hash,email,message) VALUES($1,$2,$3,$4,$5,$6)',
        [id, guest, key, fingerprint, input.email, input.message],
      );
      return { id };
    });
  }
  async list(query: PageQuery) {
    const cursor = decodeTimeCursor(query.cursor);
    const rows = (
      await this.db.query(
        'SELECT id,email,message,created_at AS "createdAt" FROM feedback WHERE ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::uuid)) ORDER BY created_at DESC,id DESC LIMIT $3',
        [cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
      )
    ).rows;
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString(
              'base64url',
            )
          : null,
    };
  }
}
