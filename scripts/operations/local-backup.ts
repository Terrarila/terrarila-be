import { generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { backup } from './backup.js';

process.umask(0o077);
const directory = resolve(process.env.BACKUP_DIR ?? 'backups');
const mediaRoot = resolve(process.env.MEDIA_ROOT ?? 'storage/assets');
if (directory === mediaRoot || directory.startsWith(mediaRoot + '/'))
  throw new Error('Keys/backups must be outside public media');
await mkdir(directory, { recursive: true, mode: 0o700 });
const actualDirectory = await realpath(directory),
  actualMedia = await realpath(mediaRoot).catch(() => mediaRoot);
if (actualDirectory === actualMedia || actualDirectory.startsWith(actualMedia + '/'))
  throw new Error('Keys/backups must be outside public media');
const keys = join(directory, 'keys');
await mkdir(keys, { recursive: true, mode: 0o700 });
const pub = join(keys, 'backup.public.pem'),
  priv = join(keys, 'backup.private.pem');
const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );
if (!(await exists(pub)) && !(await exists(priv))) {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  await writeFile(priv, pair.privateKey, { flag: 'wx', mode: 0o600 });
  await writeFile(pub, pair.publicKey, { flag: 'wx', mode: 0o600 });
} else if (!(await exists(pub)))
  throw new Error('Public key missing; do not overwrite existing private key');
await readFile(pub); // Fail before doing work when key is not readable.
process.env.BACKUP_PUBLIC_KEY = pub;
process.env.BACKUP_DIR = join(directory, 'bundles');
if (!process.env.PG_CONTAINER) {
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'ignore' });
  } catch {
    process.env.PG_CONTAINER = execFileSync('docker', ['compose', 'ps', '-q', 'postgres'], {
      encoding: 'utf8',
    }).trim();
    if (!process.env.PG_CONTAINER) throw new Error('Start PostgreSQL or install pg_dump');
  }
}
const lock = join(directory, '.backup-running');
await mkdir(lock, { mode: 0o700 });
try {
  await backup();
} finally {
  const { rm } = await import('node:fs/promises');
  await rm(lock, { recursive: true, force: true });
}
