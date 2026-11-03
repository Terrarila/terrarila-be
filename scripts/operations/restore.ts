import { mkdtemp, readFile, readdir, mkdir, rm, cp, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { validateArchive } from './safe-archive.js';
import { command, decryptArchive, hashFile, pg, pgConnection } from './backup.js';
process.umask(0o077);

async function restore() {
  const bundle = process.argv[2],
    url = process.env.RESTORE_DATABASE_URL,
    media = process.env.RESTORE_MEDIA_ROOT,
    key = process.env.BACKUP_PRIVATE_KEY;
  if (!bundle || !url || !media || !key)
    throw new Error(
      'Bundle, RESTORE_DATABASE_URL, RESTORE_MEDIA_ROOT and BACKUP_PRIVATE_KEY required',
    );
  const target = resolve(media),
    live = resolve(process.env.MEDIA_ROOT ?? 'storage/assets');
  if (target === live || target.startsWith(live + '/') || live.startsWith(target + '/'))
    throw new Error('Restore media must be separate from live media');
  if (process.env.DATABASE_URL) {
    const a = new URL(url),
      b = new URL(process.env.DATABASE_URL);
    if (
      a.hostname === b.hostname &&
      (a.port || '5432') === (b.port || '5432') &&
      a.pathname === b.pathname
    )
      throw new Error('Refusing to restore into source database');
  }
  const env = pgConnection(url);
  const pool = new Pool({
    connectionString: url,
    ssl: env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: true },
    max: 1,
  });
  const stage = await mkdtemp(join(tmpdir(), 'petite-restore-'));
  try {
    await mkdir(target, { recursive: true, mode: 0o700 });
    const actualTarget = await realpath(target),
      actualLive = await realpath(live).catch(() => live);
    if (
      actualTarget === actualLive ||
      actualTarget.startsWith(actualLive + '/') ||
      actualLive.startsWith(actualTarget + '/')
    )
      throw new Error('Restore media must be separate from live media');
    if ((await readdir(target)).length) throw new Error('Restore media directory must be empty');
    const tables = await pool.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    );
    if (tables.rows[0].count) throw new Error('Restore database must be empty');
    const archive = join(stage, 'bundle.tar');
    // Authenticate the ENTIRE archive before running tar or pg_restore.
    await decryptArchive(resolve(bundle), archive, await readFile(key, 'utf8'));
    await validateArchive(archive);
    await command('tar', ['-xf', archive, '-C', stage]);
    const manifest = JSON.parse(await readFile(join(stage, 'manifest.json'), 'utf8')) as {
      version: number;
      databaseSha256: string;
    };
    if (
      manifest.version !== 1 ||
      (await hashFile(join(stage, 'database.dump'))) !== manifest.databaseSha256
    )
      throw new Error('Backup checksum mismatch');
    // docker exec cannot read a host path: stream the dump over stdin for container mode.
    if (process.env.PG_CONTAINER) {
      const { spawn } = await import('node:child_process');
      const { createReadStream } = await import('node:fs');
      const { pipeline } = await import('node:stream/promises');
      const containerEnv = {
        ...env,
        PGHOST: '127.0.0.1',
        PGPORT: process.env.PG_CONTAINER_PORT ?? '5432',
      };
      const child = spawn(
        'docker',
        [
          'exec',
          '-i',
          ...['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE'].flatMap(
            (name) => ['-e', name],
          ),
          process.env.PG_CONTAINER,
          'pg_restore',
          `--dbname=${env.PGDATABASE}`,
          '--exit-on-error',
          '--single-transaction',
          '--no-owner',
          '--no-privileges',
        ],
        { env: containerEnv, stdio: ['pipe', 'ignore', 'pipe'] },
      );
      child.stderr.resume();
      const done = new Promise<void>((yes, no) => {
        child.on('error', no);
        child.on('close', (code) => (code === 0 ? yes() : no(new Error('pg_restore failed'))));
      });
      await Promise.all([
        pipeline(createReadStream(join(stage, 'database.dump')), child.stdin),
        done,
      ]);
    } else
      await pg(
        'pg_restore',
        [
          `--dbname=${env.PGDATABASE}`,
          '--exit-on-error',
          '--single-transaction',
          '--no-owner',
          '--no-privileges',
          join(stage, 'database.dump'),
        ],
        url,
      );
    // Old browser sessions and pending challenges must not become valid after a disaster restore.
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      await client.query('UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL');
      await client.query('DELETE FROM auth_challenges');
      await client.query(
        `INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES('operator:restore','operations.restored','00000000-0000-4000-8000-000000000000','{}')`,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await cp(join(stage, 'media'), target, { recursive: true });
    console.log(
      JSON.stringify({ event: 'restore_completed', mediaRoot: target, sessionsRevoked: true }),
    );
  } finally {
    await pool.end();
    await rm(stage, { recursive: true, force: true });
  }
}
restore().catch(() => {
  console.error(
    'Restore failed. Only empty, separate targets are accepted; inspect target before retrying.',
  );
  process.exitCode = 1;
});
