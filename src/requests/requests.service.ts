import { auditChanges } from '../common/audit-context.js';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PublicRateLimit } from '../common/public-rate-limit.js';
import { DatabaseService } from '../database/database.service.js';
import { ConfigurationService } from '../configuration/configuration.service.js';
import { decodeTimeCursor } from '../common/pagination.js';
import type { PageQuery } from '../common/pagination.js';
import type { DesignRequestDto, ReviewRequestDto, TrackRequestDto } from './requests.dto.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
@Injectable()
export class DesignRequestsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ConfigurationService) private readonly configuration: ConfigurationService,
    @Inject(PublicRateLimit) private readonly limiter: PublicRateLimit,
  ) {}
  async create(token: string, key: string, input: DesignRequestDto) {
    const body = {
      materialIds: [...input.materialIds].sort(),
      recipientName: input.recipientName.trim(),
      phone: input.phone,
      area: input.area.trim(),
      preferredDate: input.preferredDate ?? '',
      note: input.note?.trim() ?? '',
    };
    const fingerprint = hash(JSON.stringify(body));
    const guestHash = hash(token);
    const replay = (previous: Record<string, unknown>) => {
      if (previous.request_hash !== fingerprint)
        throw new ConflictException({
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'Request content changed',
        });
      return { id: previous.id, number: previous.number, status: previous.status };
    };
    const saved = (
      await this.db.query(
        'SELECT id,tracking_code AS number,status,request_hash FROM design_requests WHERE guest_hash=$1 AND idempotency_key=$2',
        [guestHash, key],
      )
    ).rows[0];
    if (saved) return replay(saved);
    const selected = await this.configuration.validate({ materialIds: body.materialIds });
    return this.db.transaction(async (client) => {
      // One guest submits serially; retries return the same persisted receipt even if stock changed.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [guestHash]);
      const previous = (
        await client.query(
          'SELECT id,tracking_code AS number,status,request_hash FROM design_requests WHERE guest_hash=$1 AND idempotency_key=$2',
          [guestHash, key],
        )
      ).rows[0];
      if (previous) return replay(previous);
      const count = (
        await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM design_requests WHERE guest_hash=$1 AND created_at>now()-interval '1 hour'",
          [guestHash],
        )
      ).rows[0]!.count;
      if (count >= 5)
        throw new HttpException(
          { code: 'REQUEST_LIMIT', message: 'Please wait before sending another request' },
          429,
        );
      const selection = selected.materials.map((item) => ({
        id: item.id,
        category: item.category,
        name: item.name,
        ...(item.parentMaterialId
          ? {
              parentMaterialId: item.parentMaterialId,
              sizeLabel: item.sizeLabel,
              priceVnd: item.priceVnd,
            }
          : {}),
      }));
      const id = randomUUID();
      let number = '';
      for (let attempt = 0; attempt < 5; attempt++) {
        number = randomBytes(4).toString('hex').toUpperCase();
        const inserted = await client.query(
          'INSERT INTO design_requests(id,number,tracking_code,guest_hash,idempotency_key,request_hash,selection,contact) VALUES($1,$2,$2,$3,$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT DO NOTHING RETURNING id',
          [
            id,
            number,
            guestHash,
            key,
            fingerprint,
            JSON.stringify(selection),
            JSON.stringify({
              recipientName: body.recipientName,
              phone: body.phone,
              area: body.area,
              preferredDate: body.preferredDate,
              note: body.note,
            }),
          ],
        );
        if (inserted.rows.length) break;
        number = '';
      }
      if (!number) throw new ServiceUnavailableException('Could not allocate request code');
      await client.query(
        "INSERT INTO request_status_events(request_id,status) VALUES($1,'pending')",
        [id],
      );
      return { id, number, status: 'pending' };
    });
  }
  async get(id: string, token: string) {
    const row = (
      await this.db.query(
        'SELECT id,tracking_code AS number,status,selection,created_at AS "createdAt",updated_at AS "updatedAt" FROM design_requests WHERE id=$1 AND guest_hash=$2',
        [id, hash(token)],
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    return { ...row, events: await this.events(id) };
  }
  private async events(id: string) {
    return (
      await this.db.query(
        'SELECT id,status,created_at AS "createdAt" FROM request_status_events WHERE request_id=$1 ORDER BY created_at,id',
        [id],
      )
    ).rows;
  }
  async track(token: string, input: TrackRequestDto) {
    await this.limiter.consume('tracking', token, 20, 900);
    const row = (
      await this.db.query(
        `SELECT id,tracking_code AS number,status,selection,created_at AS "createdAt",updated_at AS "updatedAt"
       FROM design_requests WHERE tracking_code=$1 OR number=$1`,
        [input.code],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Request not found');
    return {
      number: row.number,
      status: row.status,
      selection: row.selection,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      events: (await this.events(String(row.id))).map((event) => ({
        status: event.status,
        createdAt: event.createdAt,
      })),
    };
  }
  async list(query: PageQuery) {
    const cursor = decodeTimeCursor(query.cursor);
    const rows = (
      await this.db.query(
        'SELECT id,tracking_code AS number,number AS "legacyNumber",status,selection,contact,revision,created_at AS "createdAt" FROM design_requests WHERE ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::uuid)) ORDER BY created_at DESC,id DESC LIMIT $3',
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
  async review(id: string, revision: number, input: ReviewRequestDto, actor: string) {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          'UPDATE design_requests SET status=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING id,status,revision',
          [id, revision, input.status],
        )
      ).rows[0];
      if (!row) throw new ConflictException('Request changed; reload before editing');
      await client.query('INSERT INTO request_status_events(request_id,status) VALUES($1,$2)', [
        id,
        input.status,
      ]);
      await client.query(
        "INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES($1,'design_request.review',$2,$3::jsonb)",
        [actor, id, auditChanges(input)],
      );
      return row;
    });
  }
}
