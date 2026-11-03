import { Controller, Get, Inject, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { CONFIG } from '../common/config.js';
import type { AppConfig } from '../common/config.js';
import { DatabaseService } from '../database/database.service.js';
import { ASSET_STORAGE } from './asset-storage.js';
import type { AssetStorage } from './asset-storage.js';
import { BLOB_UPLOAD_STORE } from './blob-upload-store.js';
import type { BlobUploadStore } from './blob-upload-store.js';
import { Headers } from '@nestjs/common';

@Controller('v1/maintenance')
export class MediaMaintenanceController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
    @Inject(BLOB_UPLOAD_STORE) private readonly blobs: BlobUploadStore,
  ) {}
  @Get('media')
  async cleanup(@Headers('authorization') authorization?: string) {
    const actual = Buffer.from(authorization ?? '');
    const expected = Buffer.from(`Bearer ${this.config.cronSecret ?? ''}`);
    if (
      !this.config.cronSecret ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new UnauthorizedException();
    if (this.config.mediaStorage !== 'vercel-blob') return { removed: 0 };
    return this.db.transaction(async (client) => {
      const expired = await client.query<{ id: string; staging_path: string }>(
        `SELECT id,staging_path FROM media_upload_intents
         WHERE (result IS NULL AND expires_at<now()-interval '15 minutes')
         OR (result IS NOT NULL AND completed_at<now()-interval '1 day')
         ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`,
      );
      for (const row of expired.rows) {
        await this.blobs.remove(row.staging_path);
        const existing = await client.query('SELECT id FROM media_assets WHERE id=$1', [row.id]);
        if (!existing.rows.length) {
          await this.storage.remove(`uploads/${row.id}.webp`);
          await this.storage.remove(`uploads/${row.id}-thumb.webp`);
        }
        await client.query('DELETE FROM media_upload_intents WHERE id=$1', [row.id]);
      }
      return { removed: expired.rows.length };
    });
  }
}
