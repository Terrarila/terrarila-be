import {
  BadRequestException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CONFIG } from '../common/config.js';
import type { AppConfig } from '../common/config.js';
import { DatabaseService } from '../database/database.service.js';
import { MAX_IMAGE_BYTES, MediaService } from './media.service.js';
import { BLOB_UPLOAD_STORE } from './blob-upload-store.js';
import type { BlobUploadStore } from './blob-upload-store.js';

type Intent = {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  staging_path: string;
  expires_at: Date | string;
  result: unknown;
};
@Injectable()
export class UploadIntentsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(BLOB_UPLOAD_STORE) private readonly blobs: BlobUploadStore,
  ) {}
  async create(
    input: { originalName: string; mimeType: string; sizeBytes: number },
    actor: string,
  ) {
    if (this.config.mediaStorage !== 'vercel-blob')
      throw new BadRequestException('Direct upload is not enabled');
    const extensions: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    };
    if (!extensions[input.mimeType] || input.sizeBytes < 1 || input.sizeBytes > MAX_IMAGE_BYTES)
      throw new BadRequestException('Chọn PNG, JPG hoặc WebP tối đa 10 MiB');
    return this.db.transaction(async (client) => {
      // Bound pending uploads per admin across instances, not merely in one function's memory.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`media:${actor}`]);
      const count = (
        await client.query<{ count: string }>(
          "SELECT count(*) FROM media_upload_intents WHERE actor_id=$1 AND created_at>now()-interval '15 minutes'",
          [actor],
        )
      ).rows[0]!;
      if (Number(count.count) >= 20)
        throw new HttpException('Quá nhiều lần tải ảnh. Vui lòng thử lại sau.', 429);
      const id = randomUUID();
      const pathname = `incoming/${id}.${extensions[input.mimeType]}`;
      const expires = Date.now() + 15 * 60_000;
      const clientToken = await this.blobs.token(
        pathname,
        input.mimeType,
        input.sizeBytes,
        expires,
      );
      await client.query(
        'INSERT INTO media_upload_intents(id,actor_id,original_name,mime_type,size_bytes,staging_path,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          actor,
          input.originalName,
          input.mimeType,
          input.sizeBytes,
          pathname,
          new Date(expires),
        ],
      );
      return {
        id,
        pathname,
        clientToken,
        access: 'private' as const,
        expiresAt: new Date(expires).toISOString(),
      };
    });
  }
  async complete(id: string, actor: string) {
    if (this.config.mediaStorage !== 'vercel-blob')
      throw new BadRequestException('Direct upload is not enabled');
    let path: string | undefined;
    const result = await this.db.transaction(async (client) => {
      const intent = (
        await client.query<Intent>(
          'SELECT * FROM media_upload_intents WHERE id=$1 AND actor_id=$2 FOR UPDATE',
          [id, actor],
        )
      ).rows[0];
      if (!intent) throw new NotFoundException('Không tìm thấy lượt tải ảnh');
      path = intent.staging_path;
      if (intent.result) return intent.result;
      if (new Date(intent.expires_at).getTime() <= Date.now())
        throw new GoneException('Lượt tải ảnh đã hết hạn. Chọn ảnh lại.');
      const raw = await this.blobs.read(intent.staging_path);
      if (raw.buffer.length !== intent.size_bytes || raw.mimeType !== intent.mime_type)
        throw new BadRequestException('Ảnh tải lên không khớp thông tin đã đăng ký');
      // This transaction owns the row lock through validation and commit. Retries return the stored result.
      const asset = await this.media.upload(
        {
          buffer: raw.buffer,
          originalname: intent.original_name,
          mimetype: intent.mime_type,
          size: raw.buffer.length,
        },
        actor,
        { id, client },
      );
      await client.query(
        'UPDATE media_upload_intents SET completed_at=now(),result=$2::jsonb WHERE id=$1',
        [id, JSON.stringify(asset)],
      );
      return asset;
    });
    // Remove private raw bytes only after the DB transaction commits. A retry can clean up too.
    if (path)
      await this.blobs
        .remove(path)
        .catch(() => Logger.warn('Private upload cleanup pending', 'Media'));
    return result;
  }
}
