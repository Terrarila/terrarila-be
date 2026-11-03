// Backup contains database + media. Only encrypted bundles leave the private staging directory.
import { validateArchive } from './safe-archive.js';
import {
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  privateDecrypt,
  randomBytes,
  constants,
  createHash,
  createPublicKey,
} from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  readdir,
  stat,
  rename,
  realpath,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const magic = Buffer.from('PTBKP001');
export async function command(
  bin: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; output?: string; cwd?: string } = {},
) {
  await new Promise<void>((success, failure) => {
    const child = spawn(bin, args, {
      env: options.env ?? process.env,
      cwd: options.cwd,
      stdio: ['ignore', options.output ? 'pipe' : 'ignore', 'pipe'],
    });
    // Do not echo subprocess stderr: database errors may include connection credentials.
    child.stderr?.resume();
    const writing = options.output
      ? pipeline(child.stdout!, createWriteStream(options.output, { mode: 0o600, flags: 'wx' }))
      : Promise.resolve();
    child.on('error', failure);
    child.on('close', (code) => {
      void writing.then(
        () =>
          code === 0
            ? success()
            : failure(new Error(`${bin} failed (${code}); inspect configuration`)),
        failure,
      );
    });
  });
}
export function pgConnection(url: string) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    throw new Error('PostgreSQL URL required');
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '10',
    PGSSLMODE: process.env.PG_SSL === 'disable' ? 'disable' : 'verify-full',
  };
}
export async function pg(tool: string, args: string[], url: string, output?: string) {
  const env = pgConnection(url);
  const container = process.env.PG_CONTAINER;
  if (container) {
    env.PGHOST = '127.0.0.1';
    env.PGPORT = process.env.PG_CONTAINER_PORT ?? '5432';
  }
  const names = [
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGPASSWORD',
    'PGDATABASE',
    'PGSSLMODE',
    'PGCONNECT_TIMEOUT',
  ];
  await command(
    container ? 'docker' : tool,
    container ? ['exec', ...names.flatMap((key) => ['-e', key]), container, tool, ...args] : args,
    { env, output },
  );
}
export async function encryptArchive(archive: string, destination: string, publicKey: string) {
  const key = randomBytes(32),
    iv = randomBytes(12);
  const pub = createPublicKey(publicKey);
  if (pub.asymmetricKeyType !== 'rsa' || (pub.asymmetricKeyDetails?.modulusLength ?? 0) < 3072)
    throw new Error('Use an RSA public key of at least 3072 bits');
  const wrapped = publicEncrypt(
    { key: pub, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    key,
  );
  const header = Buffer.from(
    JSON.stringify({ iv: iv.toString('base64'), key: wrapped.toString('base64') }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  await writeFile(destination, Buffer.concat([magic, length, header]), { flag: 'wx', mode: 0o600 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.concat([magic, length, header]));
  await pipeline(createReadStream(archive), cipher, createWriteStream(destination, { flags: 'a' }));
  await writeFile(destination, cipher.getAuthTag(), { flag: 'a' });
}
export async function decryptArchive(bundle: string, destination: string, privateKey: string) {
  const { open } = await import('node:fs/promises');
  const handle = await open(bundle, 'r');
  try {
    const prefix = Buffer.alloc(12);
    await handle.read(prefix, 0, 12, 0);
    if (!prefix.subarray(0, 8).equals(magic)) throw new Error('Unsupported backup');
    const size = (await handle.stat()).size,
      length = prefix.readUInt32BE(8);
    if (length > 16384 || size < 12 + length + 16) throw new Error('Invalid backup header');
    const header = Buffer.alloc(length);
    await handle.read(header, 0, length, 12);
    const data = JSON.parse(header.toString()) as { iv: string; key: string };
    const key = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(data.key, 'base64'),
    );
    const tag = Buffer.alloc(16);
    await handle.read(tag, 0, 16, size - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'base64'));
    decipher.setAAD(Buffer.concat([prefix, header]));
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(bundle, { start: 12 + length, end: size - 17 }),
      decipher,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    );
  } finally {
    await handle.close();
  }
}
export async function hashFile(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function backup() {
  const url = process.env.DATABASE_URL,
    keyPath = process.env.BACKUP_PUBLIC_KEY;
  if (!url || !keyPath) throw new Error('DATABASE_URL and BACKUP_PUBLIC_KEY required');
  const root = resolve(process.env.MEDIA_ROOT ?? 'storage/assets');
  const destination = resolve(process.env.BACKUP_DIR ?? 'backups');
  if (destination === root || destination.startsWith(root + '/'))
    throw new Error('Backups must be outside public media');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const actualDestination = await realpath(destination),
    actualRoot = await realpath(root);
  if (actualDestination === actualRoot || actualDestination.startsWith(actualRoot + '/'))
    throw new Error('Backups must be outside public media');
  const stage = await mkdtemp(join(tmpdir(), 'petite-backup-'));
  const partial = join(
    destination,
    `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(4).toString('hex')}.ptbackup.partial`,
  );
  try {
    // Media is append-only. Copy AFTER the DB snapshot so every committed DB URL exists in the media copy.
    await pg(
      'pg_dump',
      ['-Fc', '--no-owner', '--no-privileges'],
      url,
      join(stage, 'database.dump'),
    );
    const { cp } = await import('node:fs/promises');
    await cp(root, join(stage, 'media'), {
      recursive: true,
      dereference: false,
      filter: (source) => !source.startsWith(join(root, '.incoming')),
    });
    await writeFile(
      join(stage, 'manifest.json'),
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        databaseSha256: await hashFile(join(stage, 'database.dump')),
        mediaStorage: 'local',
      }),
    );
    const archive = join(stage, 'bundle.tar');
    await command(
      'tar',
      ['--format=ustar', '-cf', archive, 'database.dump', 'manifest.json', 'media'],
      { cwd: stage },
    );
    await validateArchive(archive);
    await encryptArchive(archive, partial, await readFile(keyPath, 'utf8'));
    const final = partial.replace(/\.partial$/, '');
    await rename(partial, final);
    // Keep at least the newest bundle even when retention is set unusually low.
    const days = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
    if (!Number.isInteger(days) || days < 1)
      throw new Error('BACKUP_RETENTION_DAYS must be positive');
    for (const file of await readdir(destination)) {
      if (!/^\d{4}-.*\.ptbackup$/.test(file) || join(destination, file) === final) continue;
      if ((await stat(join(destination, file))).mtimeMs < Date.now() - days * 86400000)
        await rm(join(destination, file));
    }
    console.log(
      JSON.stringify({ event: 'backup_completed', file: final, bytes: (await stat(final)).size }),
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(partial, { force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  backup().catch(() => {
    console.error(
      'Backup failed; previous complete bundles are preserved. Check configuration and free disk space.',
    );
    process.exitCode = 1;
  });
}
