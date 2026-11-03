import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import type { QueryResultRow } from 'pg';
import { CONFIG, loadConfig } from '../common/config.js';
import type { AppConfig } from '../common/config.js';

export interface SqlClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  transaction?<T>(work: (client: SqlClient) => Promise<T>): Promise<T>;
}
export const SQL = Symbol('SQL');

export function createPool(config: AppConfig, url = config.databaseUrl) {
  const connection = new URL(url);
  // URL sslmode parameters can override pg's SSL object; keep one explicit policy.
  for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert'])
    connection.searchParams.delete(key);
  const pool = new Pool({
    connectionString: connection.toString(),
    max: config.poolMax,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 6000,
    application_name: 'terrarila-be',
    ssl: config.ssl === 'verify-full' ? { rejectUnauthorized: true } : false,
  });
  if (config.vercel) attachDatabasePool(pool);
  pool.on('error', () => Logger.error('Idle database connection failed', 'PostgreSQL'));
  return pool;
}

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  constructor(@Inject(SQL) readonly client: SqlClient) {}
  query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
    return this.client.query<T>(text, values);
  }
  async transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    if (this.client.transaction) return this.client.transaction(work);
    if (!(this.client instanceof Pool))
      throw new Error('Database adapter does not support transactions');
    const client = await this.client.connect();
    try {
      await client.query('BEGIN');
      try {
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }
  async onApplicationShutdown() {
    if (this.client instanceof Pool) await this.client.end();
  }
}

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: SQL, inject: [CONFIG], useFactory: (config: AppConfig) => createPool(config) },
    DatabaseService,
  ],
  exports: [CONFIG, DatabaseService],
})
export class DatabaseModule {}
