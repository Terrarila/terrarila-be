import {
  BadRequestException,
  Inject,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import sharp from 'sharp';
import { DatabaseService } from '../database/database.service.js';
import { ASSET_STORAGE } from './asset-storage.js';
import type { AssetStorage } from './asset-storage.js';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export type ImageUpload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
const signature = (buffer: Buffer) => {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
};
@Injectable()
export class MediaService {
  private activeUploads = 0;
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
  ) {}
  async upload(file: ImageUpload | undefined, actor: string) {
    if (!file?.buffer.length) throw new BadRequestException('Chọn một ảnh PNG, JPG hoặc WebP');
    if (file.buffer.length > MAX_IMAGE_BYTES)
      throw new PayloadTooLargeException('Ảnh tối đa 10 MiB');
    const mime = signature(file.buffer);
    if (!mime || mime !== file.mimetype)
      throw new BadRequestException('Nội dung ảnh không đúng định dạng PNG, JPG hoặc WebP');
    if (this.activeUploads >= 2)
      throw new ServiceUnavailableException('Đang xử lý ảnh khác, vui lòng thử lại');
    this.activeUploads++;
    try {
      let output;
      try {
        const decoder = sharp(file.buffer, { limitInputPixels: 40_000_000, failOn: 'warning' });
        const meta = await decoder.metadata();
        if (
          (meta.pages ?? 1) > 1 ||
          !meta.width ||
          !meta.height ||
          meta.width > 12000 ||
          meta.height > 12000
        )
          throw new Error('Invalid dimensions');
        // Lossless output preserves decoded pixels/alpha and strips embedded metadata.
        output = await decoder
          .rotate()
          .webp({ lossless: true, effort: 4 })
          .toBuffer({ resolveWithObject: true });
      } catch {
        throw new BadRequestException(
          'Ảnh hỏng, ảnh động hoặc kích thước vượt giới hạn (40 megapixel, mỗi cạnh tối đa 12000px)',
        );
      }
      if (output.data.length > 20 * 1024 * 1024)
        throw new PayloadTooLargeException('Ảnh sau xử lý quá lớn');
      const id = randomUUID();
      const key = `uploads/${id}.webp`;
      const url = `/assets/${key}`;
      const result = {
        id,
        url,
        mimeType: 'image/webp',
        sizeBytes: output.data.length,
        width: output.info.width,
        height: output.info.height,
      };
      await this.storage.put(key, output.data);
      try {
        await this.db.transaction(async (client) => {
          await client.query(
            `INSERT INTO media_assets(id,storage_provider,storage_key,url,original_name,mime_type,size_bytes,width,height,sha256,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              id,
              this.storage.provider,
              key,
              url,
              Array.from(basename(file.originalname))
                .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
                .join('')
                .slice(0, 200),
              result.mimeType,
              result.sizeBytes,
              result.width,
              result.height,
              createHash('sha256').update(output.data).digest('hex'),
              actor,
            ],
          );
          await client.query(
            "INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES($1,'media.uploaded',$2,$3::jsonb)",
            [actor, id, JSON.stringify(result)],
          );
        });
      } catch (error) {
        await this.storage.remove(key);
        throw error;
      }
      return result;
    } finally {
      this.activeUploads--;
    }
  }
}
