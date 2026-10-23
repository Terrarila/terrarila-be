import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, isUUID } from 'class-validator';

export class PageQuery {
  @ApiPropertyOptional({ type: Number, default: 24, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 24;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;
}
export function decodeCursor(cursor?: string): { sortOrder: number; id: string } | null {
  if (!cursor) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (typeof data !== 'object' || data === null) throw new Error();
    const row = data as Record<string, unknown>;
    if (!Number.isSafeInteger(row.sortOrder) || typeof row.id !== 'string' || !isUUID(row.id))
      throw new Error();
    return { sortOrder: row.sortOrder as number, id: row.id };
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
}
export function pageResult<T extends { id: string; sortOrder: number }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? Buffer.from(JSON.stringify({ sortOrder: last.sortOrder, id: last.id })).toString(
          'base64url',
        )
      : null;
  return { items, nextCursor };
}

export function decodeTimeCursor(cursor?: string): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const row: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (typeof row !== 'object' || row === null) throw new Error();
    const data = row as Record<string, unknown>;
    if (
      typeof data.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(data.createdAt)) ||
      typeof data.id !== 'string' ||
      !isUUID(data.id)
    )
      throw new Error();
    return { createdAt: data.createdAt, id: data.id };
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
}
export function parseRevision(value?: string) {
  if (!value || !/^(?:[1-9][0-9]{0,8}|"[1-9][0-9]{0,8}")$/.test(value))
    throw new BadRequestException('If-Match revision required');
  return Number(value.replaceAll('"', ''));
}
