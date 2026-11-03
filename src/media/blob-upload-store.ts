import { BadRequestException, Inject, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { del, get } from '@vercel/blob';
import { CONFIG } from '../common/config.js';
import type { AppConfig } from '../common/config.js';
import { MAX_IMAGE_BYTES } from './media.service.js';

export const BLOB_UPLOAD_STORE = Symbol('BLOB_UPLOAD_STORE');
export interface BlobUploadStore {
  token(path: string, mime: string, size: number, expiresAt: number): Promise<string>;
  read(path: string): Promise<{ buffer: Buffer; mimeType: string }>;
  remove(path: string): Promise<void>;
}
@Injectable()
export class VercelBlobUploadStore implements BlobUploadStore {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}
  token(path: string, mime: string, size: number, expiresAt: number) {
    return generateClientTokenFromReadWriteToken({
      token: this.config.blobUploadToken,
      pathname: path,
      maximumSizeInBytes: size,
      allowedContentTypes: [mime],
      validUntil: expiresAt,
      allowOverwrite: false,
      addRandomSuffix: false,
    });
  }
  async read(path: string) {
    const blob = await get(path, {
      token: this.config.blobUploadToken,
      access: 'private',
      abortSignal: AbortSignal.timeout(30_000),
    });
    if (!blob || blob.statusCode !== 200)
      throw new BadRequestException('Chưa tải được ảnh lên vùng tạm');
    const reader = blob.stream.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw new PayloadTooLargeException('Ảnh tối đa 10 MiB');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return { buffer: Buffer.concat(chunks), mimeType: blob.blob.contentType };
  }
  async remove(path: string) {
    await del(path, {
      token: this.config.blobUploadToken,
      abortSignal: AbortSignal.timeout(10_000),
    });
  }
}
