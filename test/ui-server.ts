// Explicitly ephemeral browser-test fixture: never loads .env or a real database.
import 'reflect-metadata';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { QueryResultRow } from 'pg';
import { AppModule } from '../src/app.module.js';
import { SQL } from '../src/database/database.service.js';
import type { SqlClient } from '../src/database/database.service.js';
import { CONFIG, loadConfig } from '../src/common/config.js';
import { configureApp } from '../src/bootstrap.js';
import { seedCatalog } from '../scripts/seed.js';
if (process.env.TERRALA_EPHEMERAL_UI !== 'true')
  throw new Error('Test fixture requires TERRALA_EPHEMERAL_UI=true');
const db = new PGlite();
const wrap = (database: Pick<PGlite, 'query'>): SqlClient => ({
  async query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
    return { rows: (await database.query<T>(text, values)).rows };
  },
});
const sql: SqlClient = {
  ...wrap(db),
  transaction: (work) => db.transaction((tx) => work(wrap(tx))),
};
for (const file of (await readdir('migrations')).sort())
  await db.exec(await readFile(`migrations/${file}`, 'utf8'));
await seedCatalog(sql, null);

// Illustrative prices ONLY in this ephemeral demo, never in the production seed.
await sql.query(`
  UPDATE materials m SET
    price_vnd = CASE c.code
      WHEN 'glass' THEN CASE m.legacy_id WHEN 'cubic-square' THEN 150000 ELSE 200000 END
      WHEN 'moss' THEN 30000
      WHEN 'plants' THEN 25000
      WHEN 'gravel' THEN 10000
      WHEN 'soil' THEN 15000
    END,
    unit = CASE WHEN c.code='glass' THEN 'bể' ELSE 'phần/bể (demo)' END,
    availability = 'available', revision = revision + 1
  FROM material_categories c WHERE c.id=m.category_id
`);
await sql.query(`
  UPDATE pricing_policy SET labour_bps=5000,deposit_bps=5000,
    quantity_mode='per_selection',shipping_mode='separate',
    delivery_area_codes=ARRAY['HCM'],revision=revision+1,updated_at=now()
  WHERE singleton
`);

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  PG_SSL: 'disable',
  PORT: process.env.TERRALA_UI_PORT ?? '4100',
});
const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(CONFIG)
  .useValue(config)
  .overrideProvider(SQL)
  .useValue(sql)
  .compile();
const app = module.createNestApplication({ bodyParser: false, logger: false });
await configureApp(app, config);
await app.listen(config.port, '127.0.0.1');
console.log(`Ephemeral integration-test API listening on ${config.port}; data disappears on exit.`);
