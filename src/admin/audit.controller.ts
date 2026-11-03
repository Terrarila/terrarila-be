import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Matches } from 'class-validator';
import { SessionGuard } from '../auth/session.guard.js';
import { AdminGuard } from './admin.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { PageQuery, decodeTimeCursor } from '../common/pagination.js';
export class AuditQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(120) @Matches(/^[a-zA-Z0-9_.-]+$/) action?: string;
  @IsOptional() @IsString() @MaxLength(120) actor?: string;
  @IsOptional() @IsUUID() entityId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}
@ApiTags('Admin audit')
@ApiBearerAuth()
@UseGuards(SessionGuard, AdminGuard)
@Controller('v1/admin/audit-logs')
export class AuditController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  @Get() async list(@Query() query: AuditQuery) {
    const cursor = decodeTimeCursor(query.cursor);
    const rows = (
      await this.db.query<{ id: string; createdAt: string }>(
        `SELECT id,actor_subject AS actor,action,entity_id AS "entityId",changes,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
      FROM admin_audit_log WHERE ($1::text IS NULL OR action=$1) AND ($2::text IS NULL OR actor_subject=$2)
      AND ($3::uuid IS NULL OR entity_id=$3) AND ($4::timestamptz IS NULL OR created_at>=$4)
      AND ($5::timestamptz IS NULL OR created_at<=$5)
      AND ($6::timestamptz IS NULL OR (created_at,id)<($6::timestamptz,$7::uuid))
      ORDER BY created_at DESC,id DESC LIMIT $8`,
        [
          query.action ?? null,
          query.actor ?? null,
          query.entityId ?? null,
          query.from ?? null,
          query.to ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          query.limit + 1,
        ],
      )
    ).rows;
    const items = rows.slice(0, query.limit),
      last = items.at(-1);
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
