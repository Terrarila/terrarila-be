import { Inject, Injectable } from '@nestjs/common';
import { put, del } from '@vercel/blob';
import { CONFIG } from '../common/config.js';
import type { AppConfig } from '../common/config.js';
import type { AssetStorage } from './asset-storage.js';

@Injectable()
export class BlobAssetStorage implements AssetStorage {
  readonly provider = 'vercel-blob' as const;
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}
  async put(key: string, data: Buffer) {
    if (!/^uploads\/[a-f0-9-]{36}(?:-thumb)?\.webp$/.test(key))
      throw new Error('Invalid storage key');
    const blob = await put(`assets/${key}`, data, {
      token: this.config.blobToken,
      access: 'public',
      contentType: 'image/webp',
      addRandomSuffix: false,
      // Intent IDs are stable and staging objects cannot be overwritten; safe after an interrupted finalization.
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
      abortSignal: AbortSignal.timeout(30_000),
    });
    if (new URL(blob.url).origin !== this.config.assetBaseUrl)
      throw new Error('Blob store and ASSET_BASE_URL do not match');
  }
  async remove(key: string) {
    if (!/^uploads\/[a-f0-9-]{36}(?:-thumb)?\.webp$/.test(key))
      throw new Error('Invalid storage key');
    await del(`assets/${key}`, {
      token: this.config.blobToken,
      abortSignal: AbortSignal.timeout(10_000),
    });
  }
}
