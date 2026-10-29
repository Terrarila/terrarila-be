import { Inject, Injectable } from '@nestjs/common';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG } from '../common/config.js';
import type { AppConfig } from '../common/config.js';

// Replace this adapter when moving to object storage; catalog keeps stable asset URLs.
export const ASSET_STORAGE = Symbol('ASSET_STORAGE');
export interface AssetStorage {
  readonly provider: 'local';
  put(key: string, data: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
}
@Injectable()
export class LocalAssetStorage implements AssetStorage {
  readonly provider = 'local' as const;
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}
  private path(key: string) {
    if (!/^uploads\/[a-f0-9-]{36}\.webp$/.test(key)) throw new Error('Invalid storage key');
    return join(this.config.mediaRoot, key);
  }
  async put(key: string, data: Buffer) {
    const destination = this.path(key);
    const staging = join(this.config.mediaRoot, '.incoming');
    await mkdir(staging, { recursive: true });
    await mkdir(join(this.config.mediaRoot, 'uploads'), { recursive: true });
    const temporary = join(staging, randomUUID());
    try {
      await writeFile(temporary, data, { flag: 'wx', mode: 0o640 });
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  async remove(key: string) {
    await unlink(this.path(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
