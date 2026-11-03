import 'reflect-metadata';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { CONFIG, loadConfig } from '../src/common/config.js';
import { SQL } from '../src/database/database.service.js';
import type { SqlClient } from '../src/database/database.service.js';
import { ASSET_STORAGE } from '../src/media/asset-storage.js';
import { BLOB_UPLOAD_STORE } from '../src/media/blob-upload-store.js';
import { configureApp } from '../src/bootstrap.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  PG_SSL: 'disable',
  MEDIA_STORAGE: 'vercel-blob',
  ASSET_BASE_URL: 'https://test-store.public.blob.vercel-storage.com',
  BLOB_READ_WRITE_TOKEN: 'fake-public-store',
  BLOB_UPLOAD_READ_WRITE_TOKEN: 'fake-private-store',
  CRON_SECRET: 'test-cron-secret-only',
});
const first = randomUUID(),
  second = randomUUID(),
  customer = randomUUID();
const publicFiles = new Map<string, Buffer>();
const privateFiles = new Map<string, { buffer: Buffer; mimeType: string }>();
const issued: { path: string; mime: string; size: number; expiry: number }[] = [];
let app: INestApplication;
let db: PGlite;
let sql: SqlClient;
let png: Buffer;

before(async () => {
  db = new PGlite();
  const wrap = (connection: Pick<PGlite, 'query'>): SqlClient => ({
    async query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
      return { rows: (await connection.query<T>(text, values)).rows };
    },
  });
  sql = { ...wrap(db), transaction: (work) => db.transaction((tx) => work(wrap(tx))) };
  for (const file of (await readdir('migrations')).sort())
    await db.exec(await readFile(`migrations/${file}`, 'utf8'));
  for (const [id, role] of [
    [first, 'admin'],
    [second, 'admin'],
    [customer, 'customer'],
  ])
    await sql.query('INSERT INTO users(id,email,username,role) VALUES($1,$2,$3,$4)', [
      id,
      `${id}@example.test`,
      'Fixture',
      role,
    ]);
  png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#203d32' } })
    .png()
    .toBuffer();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG)
    .useValue(config)
    .overrideProvider(SQL)
    .useValue(sql)
    .overrideProvider(AuthService)
    .useValue({
      authenticate: async (token: string) => {
        if (![first, second, customer].some((id) => id === token))
          throw new UnauthorizedException();
        return { id: token, role: token === customer ? 'customer' : 'admin', sessionId: token };
      },
    })
    .overrideProvider(ASSET_STORAGE)
    .useValue({
      provider: 'vercel-blob',
      put: async (key: string, buffer: Buffer) => {
        publicFiles.set(key, buffer);
      },
      remove: async (key: string) => {
        publicFiles.delete(key);
      },
    })
    .overrideProvider(BLOB_UPLOAD_STORE)
    .useValue({
      token: async (path: string, mime: string, size: number, expiry: number) => {
        issued.push({ path, mime, size, expiry });
        return 'limited-client-token';
      },
      read: async (path: string) => {
        const file = privateFiles.get(path);
        if (!file) throw new Error('Fixture file absent');
        return file;
      },
      remove: async (path: string) => {
        privateFiles.delete(path);
      },
    })
    .compile();
  app = module.createNestApplication({ bodyParser: false, logger: false });
  await configureApp(app, config);
});
after(async () => {
  if (app) await app.close();
  if (db) await db.close();
});
const server = () => app.getHttpServer();
async function intent(buffer = png, actor = first) {
  return (
    await request(server())
      .post('/v1/admin/media/upload-intents')
      .auth(actor, { type: 'bearer' })
      .send({ originalName: 'plant.png', mimeType: 'image/png', sizeBytes: buffer.length })
      .expect(201)
  ).body as { id: string; pathname: string; clientToken: string; access: string };
}
const complete = (id: string, actor = first) =>
  request(server())
    .post(`/v1/admin/media/upload-intents/${id}/complete`)
    .auth(actor, { type: 'bearer' });

test('cloud config requires distinct Blob stores and does not enable local storage on Vercel', () => {
  assert.throws(() => loadConfig({ VERCEL: '1', DATABASE_URL: config.databaseUrl }), /vercel-blob/);
  assert.throws(
    () => loadConfig({ MEDIA_STORAGE: 'vercel-blob', DATABASE_URL: config.databaseUrl }),
    /separate/,
  );
  assert.equal(config.mediaStorage, 'vercel-blob');
});
test('upload intents are admin-only, path-bound, private and short-lived', async () => {
  await request(server()).get('/v1/admin/media/upload-config').expect(401);
  await request(server())
    .post('/v1/admin/media/upload-intents')
    .auth(customer, { type: 'bearer' })
    .send({})
    .expect(403);
  const ready = await request(server())
    .get('/v1/admin/media/upload-config')
    .auth(first, { type: 'bearer' })
    .expect(200);
  assert.equal(ready.body.mode, 'direct');
  const item = await intent();
  assert.equal(item.access, 'private');
  assert.equal(item.pathname, `incoming/${item.id}.png`);
  assert.equal(issued.at(-1)?.size, png.length);
  assert.ok(issued.at(-1)!.expiry <= Date.now() + 15 * 60_000);
  await complete(item.id, second).expect(404);
  await complete(item.id).send({ url: 'https://untrusted.invalid/file' }).expect(400);
  await request(server())
    .post('/v1/admin/media/upload-intents')
    .auth(first, { type: 'bearer' })
    .send({ originalName: 'bad', mimeType: 'text/html', sizeBytes: 1 })
    .expect(400);
  await request(server())
    .post('/v1/admin/media/upload-intents')
    .auth(first, { type: 'bearer' })
    .send({ originalName: 'big.png', mimeType: 'image/png', sizeBytes: 10485761 })
    .expect(400);
});
test('validated finalization stores public WebP, thumbnail and audit once; retries are idempotent', async () => {
  const item = await intent();
  privateFiles.set(item.pathname, { buffer: png, mimeType: 'image/png' });
  const firstResult = await complete(item.id).expect(201);
  assert.equal(firstResult.body.url, `/assets/uploads/${item.id}.webp`);
  assert.equal((await sharp(publicFiles.get(`uploads/${item.id}.webp`)).metadata()).format, 'webp');
  assert.ok(publicFiles.has(`uploads/${item.id}-thumb.webp`));
  assert.equal(privateFiles.has(item.pathname), false);
  assert.deepEqual((await complete(item.id).expect(201)).body, firstResult.body);
  assert.equal(
    (await sql.query('SELECT id FROM media_assets WHERE id=$1', [item.id])).rows.length,
    1,
  );
  assert.equal(
    (
      await sql.query(
        "SELECT id FROM admin_audit_log WHERE action='media.uploaded' AND entity_id=$1",
        [item.id],
      )
    ).rows.length,
    1,
  );
});
test('forged bytes never become a public image and expired intents cannot finalize', async () => {
  const bad = Buffer.from('not an image');
  const item = await intent(bad);
  privateFiles.set(item.pathname, { buffer: bad, mimeType: 'image/png' });
  await complete(item.id).expect(400);
  assert.equal(publicFiles.has(`uploads/${item.id}.webp`), false);
  const expired = await intent();
  await sql.query(
    "UPDATE media_upload_intents SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [expired.id],
  );
  await complete(expired.id).expect(410);
});
test('more than 4.5 MB is read from staging and validated without a large Function request body', async () => {
  const big = await sharp(randomBytes(1300 * 1300 * 3), {
    raw: { width: 1300, height: 1300, channels: 3 },
  })
    .png()
    .toBuffer();
  assert.ok(big.length > 4.5 * 1024 * 1024);
  const item = await intent(big);
  privateFiles.set(item.pathname, { buffer: big, mimeType: 'image/png' });
  const result = await complete(item.id).expect(201);
  assert.equal(result.body.width, 1300);
});
test('assets redirect to the configured CDN; cleanup authenticates and only deletes expired staging/orphans', async () => {
  const asset = await request(server()).get('/assets/uploads/example.webp').expect(307);
  assert.equal(asset.headers.location, `${config.assetBaseUrl}/assets/uploads/example.webp`);
  const expired = await intent();
  privateFiles.set(expired.pathname, { buffer: png, mimeType: 'image/png' });
  await sql.query(
    "UPDATE media_upload_intents SET expires_at=now()-interval '1 hour' WHERE id=$1",
    [expired.id],
  );
  await request(server()).get('/v1/maintenance/media').expect(401);
  const result = await request(server())
    .get('/v1/maintenance/media')
    .auth(config.cronSecret!, { type: 'bearer' })
    .expect(200);
  assert.ok(result.body.removed >= 1);
  assert.equal(privateFiles.has(expired.pathname), false);
  assert.ok(publicFiles.size >= 4);
});
