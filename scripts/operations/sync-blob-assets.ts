// Copy existing media without changing catalog URLs or deleting any local files.
import { readdir, readFile, lstat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig } from '../../src/common/config.js';
import { createPool } from '../../src/database/database.service.js';
import { BlobNotFoundError, head, put, get } from '@vercel/blob';

const apply = process.argv.includes('--apply');
const markProvider = process.argv.includes('--mark-provider');
if (markProvider && !apply) throw new Error('--mark-provider requires --apply');
const verifiedKeys: string[] = [];
const root = resolve(process.env.MEDIA_ROOT ?? 'storage/assets');
const token = process.env.BLOB_READ_WRITE_TOKEN;
const types: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  glb: 'model/gltf-binary',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};
let files = 0;
let bytes = 0;
async function walk(directory: string): Promise<void> {
  for (const name of (await readdir(directory)).sort()) {
    if (name.startsWith('.')) continue;
    const full = join(directory, name);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) throw new Error('Asset migration refuses symbolic links');
    if (stat.isDirectory()) {
      await walk(full);
      continue;
    }
    if (!stat.isFile()) throw new Error('Unsupported asset entry');
    const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
    const mime = types[extension];
    if (!mime) throw new Error(`Unexpected asset type: ${extension}`);
    const pathname = `assets/${relative(root, full).split('\\').join('/')}`;
    files++;
    bytes += stat.size;
    if (!apply) continue;
    if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is required for --apply');
    const local = await readFile(full);
    try {
      await head(pathname, { token });
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) throw error;
      await put(pathname, local, {
        token,
        access: 'public',
        contentType: mime,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 31536000,
      });
    }
    // Existing immutable paths must contain the exact same bytes, not merely the same size.
    const remote = await get(pathname, { token, access: 'public' });
    if (!remote || remote.statusCode !== 200) throw new Error('Blob verification failed');
    if (
      process.env.ASSET_BASE_URL &&
      new URL(remote.blob.url).origin !== process.env.ASSET_BASE_URL.replace(/\/$/, '')
    )
      throw new Error('Blob store and ASSET_BASE_URL do not match');
    const hash = createHash('sha256');
    for await (const chunk of remote.stream) hash.update(chunk);
    if (hash.digest('hex') !== createHash('sha256').update(local).digest('hex'))
      throw new Error(`Blob content mismatch at ${pathname}; refusing overwrite`);
    verifiedKeys.push(pathname.slice('assets/'.length));
  }
}
await walk(root);
if (markProvider) {
  const config = loadConfig();
  const pool = createPool(config, process.env.MIGRATION_DATABASE_URL ?? config.databaseUrl);
  try {
    const rows = await pool.query<{ storage_key: string }>(
      "SELECT storage_key FROM media_assets WHERE storage_provider='local'",
    );
    if (rows.rows.some((row) => !verifiedKeys.includes(row.storage_key)))
      throw new Error('Some database assets were not verified; no provider metadata changed');
    await pool.query(
      "UPDATE media_assets SET storage_provider='vercel-blob' WHERE storage_provider='local' AND storage_key=ANY($1::text[])",
      [verifiedKeys],
    );
  } finally {
    await pool.end();
  }
}
console.log(JSON.stringify({ dryRun: !apply, files, bytes, verified: apply }));
