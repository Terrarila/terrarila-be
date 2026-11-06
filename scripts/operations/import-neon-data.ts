import { Pool } from 'pg';
import { ImportError, importNeonData } from './neon-import.js';

function connection(value: string | undefined, name: string) {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new ImportError(`${name} is required and must be a PostgreSQL URL.`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.username ||
    url.pathname.length < 2
  )
    throw new ImportError(`${name} must include a PostgreSQL user and database.`);
  for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert'])
    url.searchParams.delete(key);
  return url;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply') || args.length > 1)
    throw new ImportError('Usage: npm run db:import-neon [-- --apply]');
  const source = connection(process.env.SOURCE_DATABASE_URL, 'SOURCE_DATABASE_URL');
  const target = connection(process.env.TARGET_DATABASE_URL, 'TARGET_DATABASE_URL');
  if (!target.hostname.endsWith('.neon.tech') || target.hostname.includes('-pooler'))
    throw new ImportError(
      'TARGET_DATABASE_URL must be a direct Neon connection, not a pooled URL.',
    );
  if (
    source.hostname.replace('-pooler', '') === target.hostname &&
    (source.port || '5432') === (target.port || '5432') &&
    decodeURIComponent(source.pathname) === decodeURIComponent(target.pathname)
  )
    throw new ImportError('Source and target must be different databases.');
  const localSource = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(source.hostname);
  if (process.env.SOURCE_PG_SSL && !['disable', 'verify-full'].includes(process.env.SOURCE_PG_SSL))
    throw new ImportError('SOURCE_PG_SSL must be disable or verify-full.');
  if (!localSource && process.env.SOURCE_PG_SSL === 'disable')
    throw new ImportError('Remote source requires verified TLS.');
  const options = {
    max: 1,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    query_timeout: 35000,
    application_name: 'terrarila-neon-import',
  };
  const sourcePool = new Pool({
    ...options,
    connectionString: source.toString(),
    ssl:
      localSource && process.env.SOURCE_PG_SSL === 'disable' ? false : { rejectUnauthorized: true },
  });
  const targetPool = new Pool({
    ...options,
    connectionString: target.toString(),
    ssl: { rejectUnauthorized: true },
  });
  for (const pool of [sourcePool, targetPool])
    pool.on('error', () => console.error('Import connection failed.'));
  let sourceClient, targetClient;
  try {
    sourceClient = await sourcePool.connect();
    targetClient = await targetPool.connect();
    console.log(
      JSON.stringify(
        await importNeonData(sourceClient, targetClient, args.includes('--apply')),
        null,
        2,
      ),
    );
  } finally {
    sourceClient?.release();
    targetClient?.release();
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}

main().catch((error: unknown) => {
  // pg errors can contain query values and credentials: never print the raw error.
  console.error(
    error instanceof ImportError
      ? error.message
      : 'Import failed and the transaction was rolled back if still open. Check connection, role permissions and schema.',
  );
  process.exitCode = 1;
});
