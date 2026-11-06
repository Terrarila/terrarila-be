// Explicit smoke test: isolated PostgreSQL only, no .env or live database URLs.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { seedCatalog } from '../seed.js';
import { seedAdminUi } from '../../test/admin-ui-fixture.js';
import { importNeonData } from './neon-import.js';

const exec = promisify(execFile);
const name = `petite-import-test-${randomUUID().slice(0, 8)}`;
let source: Pool | undefined;
let target: Pool | undefined;
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
  source = new Pool({
    connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres`,
    max: 1,
  });
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
  if (!ready) throw new Error('Fixture PostgreSQL did not become ready');
  await source.query('CREATE DATABASE import_target');
  target = new Pool({
    connectionString: `postgresql://postgres@127.0.0.1:${port}/import_target`,
    max: 1,
  });
  for (const pool of [source, target]) {
    await pool.query(
      'CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const migration of (await readdir('migrations'))
      .filter((file) => file.endsWith('.sql'))
      .sort()) {
      const sql = await readFile(`migrations/${migration}`, 'utf8');
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
        migration,
        createHash('sha256').update(sql).digest('hex'),
      ]);
    }
  }
  await seedCatalog(source, null);
  await seedAdminUi(source, 'Synthetic-import-test-password');
  const sourceClient = await source.connect();
  const targetClient = await target.connect();
  try {
    const plan = await importNeonData(sourceClient, targetClient);
    assert.ok(plan.tables.find((table) => table.table === 'products')!.sourceRows > 0);
    assert.equal(
      (await targetClient.query('SELECT count(*)::int AS count FROM users')).rows[0].count,
      0,
    );
    const result = await importNeonData(sourceClient, targetClient, true);
    assert.equal(result.verified, true);
    for (const table of [
      'products',
      'materials',
      'orders',
      'quotes',
      'invoices',
      'admin_credentials',
    ]) {
      const a = await sourceClient.query(`SELECT count(*)::int AS count FROM public.${table}`);
      const b = await targetClient.query(`SELECT count(*)::int AS count FROM public.${table}`);
      assert.equal(b.rows[0].count, a.rows[0].count);
    }
    assert.equal(
      (await targetClient.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count,
      0,
    );
    await assert.rejects(importNeonData(sourceClient, targetClient, true), /contains data/);
    console.log(
      JSON.stringify({
        postgres: 17,
        dryRun: 'passed',
        importAndContentVerification: 'passed',
        reimportRefusal: 'passed',
        liveDatabasesUsed: false,
      }),
    );
  } finally {
    sourceClient.release();
    targetClient.release();
  }
} finally {
  await Promise.all([source?.end(), target?.end()]);
  await exec('docker', ['rm', '-f', name]).catch(() => undefined);
}
