import { createHash } from 'node:crypto';

export interface ImportClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export class ImportError extends Error {}

// Parent tables precede their children. All material rows are inserted in one
// statement so the self-referencing size/shape FK is checked together.
const tables = [
  'material_categories',
  'users',
  'admin_credentials',
  'materials',
  'products',
  'portfolio_entries',
  'site_content',
  'pricing_policy',
  'design_presets',
  'design_preset_materials',
  'quotes',
  'orders',
  'invoices',
  'payments',
  'design_requests',
  'request_status_events',
  'feedback',
  'media_assets',
  'admin_audit_log',
] as const;
const skipped = [
  'sessions',
  'auth_challenges',
  'auth_login_limits',
  'media_upload_intents',
  'public_request_limits',
];
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
const tableName = (name: string) => `public.${identifier(name)}`;
const digest = (rows: string[]) =>
  createHash('sha256')
    .update([...rows].sort().join('\n'))
    .digest('hex');
const maxRows = 100_000;
const maxBytes = 64 * 1024 * 1024;

async function describe(client: ImportClient, label: 'SOURCE' | 'TARGET') {
  const names = (
    await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
    )
  ).rows
    .map((row) => row.table_name)
    .sort();
  const expected = [...tables, ...skipped, 'schema_migrations'].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected))
    throw new ImportError(
      `${label} public tables differ. Missing: ${expected.filter((name) => !names.includes(name)).join(', ') || 'none'}. Unexpected: ${names.filter((name) => !expected.includes(name)).join(', ') || 'none'}. Apply migrations through 017 to ${label} first.`,
    );
  const migrations = (
    await client.query('SELECT name,checksum FROM public.schema_migrations ORDER BY name')
  ).rows;
  if (migrations.length !== 17 || migrations.at(-1)?.name !== '017_tracking_feedback.sql')
    throw new ImportError(`${label} must have migrations 001 through 017.`);
  const columns = (
    await client.query<{
      table_name: string;
      column_name: string;
      is_identity: string;
      is_generated: string;
    }>(
      `SELECT table_name,column_name,udt_schema,udt_name,is_nullable,is_identity,is_generated
     FROM information_schema.columns WHERE table_schema='public'
     ORDER BY table_name,ordinal_position`,
    )
  ).rows;
  if (columns.some((column) => column.is_identity !== 'NO' || column.is_generated !== 'NEVER'))
    throw new ImportError('Identity/generated columns require a reviewed importer update.');
  const sequences = (
    await client.query(
      "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'",
    )
  ).rows;
  if (sequences.length) throw new ImportError('Sequences require a reviewed importer update.');
  return { migrations, columns };
}

async function count(client: ImportClient, table: string) {
  const value = Number(
    (
      await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${tableName(table)}`,
      )
    ).rows[0]?.count,
  );
  if (!Number.isSafeInteger(value) || value < 0) throw new ImportError('Invalid row count.');
  return value;
}

async function readRows(client: ImportClient, table: string) {
  // Keep PostgreSQL JSON as text: bigint and timestamp precision must not pass
  // through JavaScript's number or Date conversions.
  return (
    await client.query<{ data: string }>(
      `SELECT to_jsonb(row)::text AS data FROM ${tableName(table)} AS row`,
    )
  ).rows.map((row) => row.data);
}

export async function importNeonData(source: ImportClient, target: ImportClient, apply = false) {
  let sourceOpen = false;
  let targetOpen = false;
  try {
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    sourceOpen = true;
    await source.query("SET LOCAL TIME ZONE 'UTC'");
    await target.query(
      apply
        ? 'BEGIN ISOLATION LEVEL SERIALIZABLE'
        : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    targetOpen = true;
    await target.query("SET LOCAL TIME ZONE 'UTC'");
    if (apply) {
      await target.query("SET LOCAL lock_timeout='5s'");
      await target.query(
        `LOCK TABLE ${[...tables, ...skipped, 'schema_migrations'].sort().map(tableName).join(',')} IN SHARE ROW EXCLUSIVE MODE`,
      );
    }
    const sourceSchema = await describe(source, 'SOURCE');
    const targetSchema = await describe(target, 'TARGET');
    if (JSON.stringify(sourceSchema) !== JSON.stringify(targetSchema))
      throw new ImportError('Source and target schema/migration checksums differ.');

    const snapshots = new Map<string, string[]>();
    const summary: Array<{ table: string; sourceRows: number; targetRows: number }> = [];
    let bytes = 0;
    let totalRows = 0;
    for (const table of [...tables, ...skipped]) {
      const sourceRows = await count(source, table);
      const targetRows = await count(target, table);
      summary.push({ table, sourceRows, targetRows });
      if (table !== 'pricing_policy' && targetRows !== 0)
        throw new ImportError(
          `Target table ${table} contains data; no merge or overwrite is allowed.`,
        );
      if (skipped.includes(table)) continue;
      totalRows += sourceRows;
      if (totalRows > maxRows)
        throw new ImportError('Import exceeds 100000 rows; use a reviewed bulk migration.');
      const rows = await readRows(source, table);
      if (rows.length !== sourceRows) throw new ImportError('Source snapshot row count changed.');
      bytes += rows.reduce((size, row) => size + Buffer.byteLength(row), 0);
      if (bytes > maxBytes)
        throw new ImportError('Import exceeds 64 MiB; use a reviewed bulk migration.');
      snapshots.set(table, rows);
    }
    if (snapshots.get('pricing_policy')?.length !== 1)
      throw new ImportError('Source must contain exactly one pricing policy.');
    const targetPricing = await readRows(target, 'pricing_policy');
    const expectedPricing = {
      singleton: true,
      labour_vnd: null,
      deposit_bps: 5000,
      quantity_mode: null,
      shipping_mode: 'separate',
      delivery_area_codes: ['HCM'],
      revision: 2,
      labour_bps: 5000,
    };
    if (
      targetPricing.length > 1 ||
      targetPricing.some((text) => {
        const row = JSON.parse(text) as Record<string, unknown>;
        delete row.updated_at;
        return (
          Object.keys(row).length !== Object.keys(expectedPricing).length ||
          Object.entries(expectedPricing).some(
            ([key, value]) => JSON.stringify(row[key]) !== JSON.stringify(value),
          )
        );
      })
    )
      throw new ImportError('Target pricing policy was changed; refusing to replace it.');

    if (apply) {
      // This is the only replaced row, and it was verified as migration defaults.
      await target.query('DELETE FROM public.pricing_policy WHERE singleton=true');
      for (const table of tables) {
        const rows = snapshots.get(table)!;
        if (!rows.length) continue;
        const columns = sourceSchema.columns
          .filter((column) => column.table_name === table)
          .map((column) => identifier(column.column_name))
          .join(',');
        await target.query(
          `INSERT INTO ${tableName(table)} (${columns}) SELECT ${columns} FROM jsonb_populate_recordset(NULL::${tableName(table)},$1::jsonb)`,
          [`[${rows.join(',')}]`],
        );
      }
      for (const table of tables) {
        const rows = await readRows(target, table);
        const original = snapshots.get(table)!;
        if (rows.length !== original.length || digest(rows) !== digest(original))
          throw new ImportError(
            `Verification failed for ${table}; rolling back all imported rows.`,
          );
      }
      await target.query(
        `INSERT INTO public.admin_audit_log(actor_subject,action,entity_id,changes)
         VALUES('operator:neon-import','operations.imported','00000000-0000-4000-8000-000000000000',$1::jsonb)`,
        [
          JSON.stringify({
            tables: summary.filter((row) => !skipped.includes(row.table)),
            sessionsCopied: false,
          }),
        ],
      );
    }
    await source.query('COMMIT');
    sourceOpen = false;
    await target.query('COMMIT');
    targetOpen = false;
    return { dryRun: !apply, verified: apply, bytes, tables: summary, skipped };
  } finally {
    try {
      if (targetOpen) await target.query('ROLLBACK');
    } finally {
      if (sourceOpen) await source.query('ROLLBACK');
    }
  }
}
