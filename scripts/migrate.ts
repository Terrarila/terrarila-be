import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { loadConfig } from '../src/common/config.js';
import type { PoolClient } from 'pg';
import { createPool } from '../src/database/database.service.js';

const config = loadConfig();
const pool = createPool(
  { ...config, poolMax: 1 },
  process.env.MIGRATION_DATABASE_URL ?? config.databaseUrl,
);
let client: PoolClient | undefined;
try {
  client = await pool.connect();
  await client.query('SELECT pg_advisory_lock(674321908)');
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const files = (await readdir('migrations'))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  for (const name of files) {
    const sql = await readFile(`migrations/${name}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = (
      await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name=$1',
        [name],
      )
    ).rows[0];
    if (previous) {
      if (previous.checksum !== checksum)
        throw new Error(`Migration changed after application: ${name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
        name,
        checksum,
      ]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  try {
    if (client) await client.query('SELECT pg_advisory_unlock(674321908)');
  } finally {
    client?.release();
    await pool.end();
  }
}
