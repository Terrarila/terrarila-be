import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { importNeonData } from '../scripts/operations/neon-import.js';
import type { ImportClient } from '../scripts/operations/neon-import.js';

const ids = {
  category: '10000000-0000-4000-8000-000000000001',
  user: '10000000-0000-4000-8000-000000000002',
  parent: '10000000-0000-4000-8000-000000000003',
  child: '10000000-0000-4000-8000-000000000004',
  product: '10000000-0000-4000-8000-000000000005',
};
function adapter(db: PGlite): ImportClient {
  return { query: (sql, values) => db.query(sql, values) };
}
async function database() {
  const db = new PGlite();
  await db.exec(
    'CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(`migrations/${name}`, 'utf8');
    await db.exec(sql);
    await db.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
      name,
      createHash('sha256').update(sql).digest('hex'),
    ]);
  }
  return db;
}
async function fixtures(work: (source: PGlite, target: PGlite) => Promise<void>) {
  const source = await database();
  const target = await database();
  try {
    await source.query(
      "INSERT INTO material_categories(id,code,name,selection_mode,max_selections) VALUES($1,'glass','Glass','single',1)",
      [ids.category],
    );
    await source.query(
      "INSERT INTO users(id,email,username,role) VALUES($1,'private@example.com','old admin','admin')",
      [ids.user],
    );
    await source.query(
      "INSERT INTO admin_credentials(user_id,email,password_hash) VALUES($1,'private@example.com','preserved-password-hash')",
      [ids.user],
    );
    await source.query(
      `INSERT INTO materials(id,category_id,legacy_id,slug,name,parent_material_id,size_label) VALUES
      ($1,$3,'size','size','Size',$2,'10x10'),($2,$3,'shape','shape','Shape',NULL,NULL)`,
      [ids.child, ids.parent, ids.category],
    );
    await source.query(
      "INSERT INTO products(id,slug,name,price_vnd,images) VALUES($1,'old-product',$2,NULL,$3::jsonb)",
      [ids.product, "Old product's name", JSON.stringify([{ url: '/assets/uploads/old.webp' }])],
    );
    await source.exec("UPDATE pricing_policy SET quantity_mode='quantity',revision=9");
    await source.query(
      "INSERT INTO site_content(key,data,published,revision) VALUES('about',$1::jsonb,true,7)",
      [JSON.stringify({ text: "Old owner's content" })],
    );
    await source.query(
      "INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(gen_random_uuid(),$1,'old-session-secret',now()+interval '1 day')",
      [ids.user],
    );
    await source.exec(
      "INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES('old-admin','product.updated','10000000-0000-4000-8000-000000000005','{}')",
    );
    await work(source, target);
  } finally {
    await source.close();
    await target.close();
  }
}

test('Neon import dry-run leaves both databases unchanged and reports no private rows', async () => {
  await fixtures(async (source, target) => {
    const result = await importNeonData(adapter(source), adapter(target));
    assert.equal(result.dryRun, true);
    assert.equal(result.tables.find((table) => table.table === 'products')?.sourceRows, 1);
    assert.equal(
      (await target.query<{ count: number }>('SELECT count(*)::int AS count FROM products')).rows[0]
        ?.count,
      0,
    );
    assert.equal(
      (await target.query<{ revision: number }>('SELECT revision FROM pricing_policy')).rows[0]
        ?.revision,
      2,
    );
    assert.equal(JSON.stringify(result).includes('private@example.com'), false);
    assert.equal(JSON.stringify(result).includes('password-hash'), false);
  });
});

test('Neon import preserves IDs, self-FKs, null prices, credentials and revisions but excludes sessions', async () => {
  await fixtures(async (source, target) => {
    await source.exec(`UPDATE products SET created_at='2026-01-01T00:00:00.123456Z',
      images=images || '[{"rawNumber":9007199254740993}]'::jsonb`);
    const result = await importNeonData(adapter(source), adapter(target), true);
    assert.equal(result.verified, true);
    const product = (
      await target.query<{ id: string; name: string; price_vnd: null }>('SELECT * FROM products')
    ).rows[0]!;
    assert.equal(product.id, ids.product);
    assert.equal(product.name, "Old product's name");
    assert.equal(product.price_vnd, null);
    const precision = (
      await target.query<{ number: string; micros: string }>(
        "SELECT images->1->>'rawNumber' AS number,to_char(created_at AT TIME ZONE 'UTC','US') AS micros FROM products",
      )
    ).rows[0]!;
    assert.equal(precision.number, '9007199254740993');
    assert.equal(precision.micros, '123456');
    assert.equal(
      (
        await target.query<{ parent_material_id: string }>(
          'SELECT parent_material_id FROM materials WHERE id=$1',
          [ids.child],
        )
      ).rows[0]?.parent_material_id,
      ids.parent,
    );
    assert.equal(
      (await target.query<{ password_hash: string }>('SELECT password_hash FROM admin_credentials'))
        .rows[0]?.password_hash,
      'preserved-password-hash',
    );
    assert.equal(
      (await target.query<{ revision: number }>('SELECT revision FROM pricing_policy')).rows[0]
        ?.revision,
      9,
    );
    assert.equal(
      (await target.query<{ count: number }>('SELECT count(*)::int AS count FROM sessions')).rows[0]
        ?.count,
      0,
    );
    assert.equal(
      (await source.query<{ count: number }>('SELECT count(*)::int AS count FROM sessions')).rows[0]
        ?.count,
      1,
    );
    assert.equal(
      (
        await target.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='operations.imported'",
        )
      ).rows[0]?.count,
      1,
    );
    await assert.rejects(importNeonData(adapter(source), adapter(target), true), /contains data/);
  });
});

test('Neon import refuses target business data and changed default pricing', async () => {
  await fixtures(async (source, target) => {
    await target.exec("INSERT INTO site_content(key,data) VALUES('about','{}')");
    await assert.rejects(importNeonData(adapter(source), adapter(target), true), /contains data/);
    await target.exec(
      "DELETE FROM site_content; UPDATE pricing_policy SET quantity_mode='quantity'",
    );
    await assert.rejects(
      importNeonData(adapter(source), adapter(target), true),
      /pricing policy was changed/,
    );
    assert.equal(
      (await target.query<{ count: number }>('SELECT count(*)::int AS count FROM products')).rows[0]
        ?.count,
      0,
    );
  });
});

test('Neon import rejects migration checksum and column drift', async () => {
  await fixtures(async (source, target) => {
    await target.exec(
      "UPDATE schema_migrations SET checksum='changed' WHERE name='001_catalog.sql'",
    );
    await assert.rejects(importNeonData(adapter(source), adapter(target)), /checksums differ/);
    await target.query("UPDATE schema_migrations SET checksum=$1 WHERE name='001_catalog.sql'", [
      (
        await source.query<{ checksum: string }>(
          "SELECT checksum FROM schema_migrations WHERE name='001_catalog.sql'",
        )
      ).rows[0]!.checksum,
    ]);
    await target.exec('ALTER TABLE products ADD COLUMN unexpected text');
    await assert.rejects(importNeonData(adapter(source), adapter(target)), /checksums differ/);
  });
});

test('Neon import identifies the source when its migration 016 is missing', async () => {
  await fixtures(async (source, target) => {
    await source.exec(
      "DROP TABLE media_upload_intents; DELETE FROM schema_migrations WHERE name='016_vercel_media.sql'",
    );
    await assert.rejects(
      importNeonData(adapter(source), adapter(target)),
      /SOURCE public tables differ\. Missing: media_upload_intents/,
    );
  });
});

test('Neon import rolls back when a target trigger changes imported row content', async () => {
  await fixtures(async (source, target) => {
    await target.exec(`CREATE FUNCTION change_imported_product() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.name='changed by target trigger'; RETURN NEW; END; $$;
      CREATE TRIGGER change_imported_product BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION change_imported_product()`);
    await assert.rejects(
      importNeonData(adapter(source), adapter(target), true),
      /Verification failed for products/,
    );
    assert.equal(
      (await target.query<{ count: number }>('SELECT count(*)::int AS count FROM products')).rows[0]
        ?.count,
      0,
    );
    assert.equal(
      (await target.query<{ revision: number }>('SELECT revision FROM pricing_policy')).rows[0]
        ?.revision,
      2,
    );
  });
});

test('Neon import rolls back prior writes and pricing replacement on insertion failure', async () => {
  await fixtures(async (source, target) => {
    const wrapped: ImportClient = {
      query(sql, values) {
        if (sql.startsWith('INSERT INTO public."products"'))
          throw new Error('Simulated insert failure');
        return adapter(target).query(sql, values);
      },
    };
    await assert.rejects(importNeonData(adapter(source), wrapped, true), /Simulated insert/);
    assert.equal(
      (await target.query<{ count: number }>('SELECT count(*)::int AS count FROM users')).rows[0]
        ?.count,
      0,
    );
    assert.equal(
      (await target.query<{ revision: number }>('SELECT revision FROM pricing_policy')).rows[0]
        ?.revision,
      2,
    );
  });
});
