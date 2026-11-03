// Explicit Docker smoke test. Creates its own server/databases/media/keys and always removes them.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { command } from './backup.js';
import { seedAdminUi } from '../../test/admin-ui-fixture.js';
const exec = promisify(execFile),
  name = `petite-restore-test-${randomUUID().slice(0, 8)}`;
const directory = await mkdtemp(join(tmpdir(), 'petite-restore-check-'));
let source: Pool | undefined, target: Pool | undefined;
try {
  await exec('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '-p',
    '127.0.0.1::5432',
    'postgres:17',
  ]);
  const port = (await exec('docker', ['port', name, '5432/tcp'])).stdout.trim().split(':').at(-1)!;
  const sourceUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`,
    targetUrl = `postgresql://postgres@127.0.0.1:${port}/petite_restore_check`;
  source = new Pool({ connectionString: sourceUrl, max: 1 });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await source.query('SELECT 1');
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!ready) throw new Error('Test database did not become ready');
  await source.query('CREATE DATABASE petite_restore_check');
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: sourceUrl,
    PG_SSL: 'disable',
    PG_CONTAINER: name,
    MEDIA_ROOT: join(directory, 'media'),
    BACKUP_DIR: join(directory, 'backups'),
  };
  await mkdir(env.MEDIA_ROOT);
  await writeFile(join(env.MEDIA_ROOT, 'fixture.txt'), 'Synthetic media only');
  const run = (script: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}) =>
    command(process.execPath, ['--import', 'tsx', script, ...args], { env: { ...env, ...extra } });
  await run('scripts/migrate.ts');
  await run('scripts/seed.ts');
  // Existing explicitly synthetic order/request fixture; no real customer's data is used.
  await seedAdminUi(
    { query: async (text, values) => ({ rows: (await source!.query(text, values)).rows }) },
    'Restore-fixture-only-password',
  );
  await source.query(`INSERT INTO payments(order_id,amount_vnd,reference,confirmed_by)
    SELECT id,100000,'restore-fixture-payment',user_id FROM orders LIMIT 1`);
  await source.query("UPDATE orders SET paid_vnd=100000,status='confirmed'");

  const user = (
    await source.query(
      "INSERT INTO users(email,username,role) VALUES('fixture@example.test','Backup fixture','admin') RETURNING id",
    )
  ).rows[0];
  await source.query(
    "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,repeat('b',64),now()+interval '1 day')",
    [user.id],
  );
  await assert.rejects(
    run('scripts/operations/local-backup.ts', [], { BACKUP_DIR: join(env.MEDIA_ROOT, 'backups') }),
  );
  assert.deepEqual(await readdir(env.MEDIA_ROOT), ['fixture.txt']);
  await run('scripts/operations/local-backup.ts');
  const offlineKey = join(directory, 'offline.private.pem');
  await rename(join(env.BACKUP_DIR, 'keys', 'backup.private.pem'), offlineKey);
  await run('scripts/operations/local-backup.ts');
  const bundle = join(
    env.BACKUP_DIR,
    'bundles',
    (await readdir(join(env.BACKUP_DIR, 'bundles')))[0]!,
  );
  const restoreEnv = {
    RESTORE_DATABASE_URL: targetUrl,
    RESTORE_MEDIA_ROOT: join(directory, 'restored'),
    BACKUP_PRIVATE_KEY: offlineKey,
  };
  await run('scripts/operations/restore.ts', [bundle], restoreEnv);
  target = new Pool({ connectionString: targetUrl, max: 1 });
  for (const table of [
    'materials',
    'products',
    'site_content',
    'users',
    'sessions',
    'design_requests',
    'orders',
    'quotes',
    'invoices',
    'payments',
  ]) {
    const sourceCount: number = Number(
      (await source.query(`SELECT count(*)::int count FROM ${table}`)).rows[0].count,
    );
    const restoredCount: number = Number(
      (await target.query(`SELECT count(*)::int count FROM ${table}`)).rows[0].count,
    );
    assert.equal(sourceCount, restoredCount);
  }
  assert.deepEqual(
    (await source.query('SELECT snapshot,contact,paid_vnd,status FROM orders ORDER BY id')).rows,
    (await target.query('SELECT snapshot,contact,paid_vnd,status FROM orders ORDER BY id')).rows,
  );
  assert.deepEqual(
    (await source.query('SELECT amount_vnd,reference FROM payments ORDER BY id')).rows,
    (await target.query('SELECT amount_vnd,reference FROM payments ORDER BY id')).rows,
  );
  assert.equal(
    (await target.query('SELECT count(*)::int count FROM sessions WHERE revoked_at IS NULL'))
      .rows[0].count,
    0,
  );
  assert.equal(
    (
      await target.query(
        "SELECT count(*)::int count FROM admin_audit_log WHERE action='operations.restored'",
      )
    ).rows[0].count,
    1,
  );
  assert.deepEqual(
    await readFile(join(env.MEDIA_ROOT, 'fixture.txt')),
    await readFile(join(restoreEnv.RESTORE_MEDIA_ROOT, 'fixture.txt')),
  );
  await assert.rejects(run('scripts/operations/restore.ts', [bundle], restoreEnv));
  console.log(
    'PostgreSQL restore smoke passed: data/media matched, old sessions revoked, restore audited, non-empty targets refused.',
  );
} finally {
  await source?.end();
  await target?.end();
  await exec('docker', ['rm', '-f', name]).catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
