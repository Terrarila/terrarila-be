import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { CONFIG, loadConfig } from '../src/common/config.js';
import { SQL, createPool } from '../src/database/database.service.js';
import type { SqlClient } from '../src/database/database.service.js';
import { GOOGLE_VERIFY, createGoogleVerifier } from '../src/auth/google.js';
import { seedCatalog } from '../scripts/seed.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost/test',
  PG_SSL: process.env.TEST_PG_SSL ?? 'disable',
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  SWAGGER_ENABLED: 'true',
});
let app: INestApplication;
let sql: SqlClient;
let cleanup: () => Promise<void>;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let members: { id: string; category: string; legacyId: string }[];
let subject = 10000;

before(async () => {
  if (process.env.TEST_DATABASE_URL) {
    const admin = createPool(config);
    const schema = `test_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(config.databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    const pool = createPool(config, url.toString());
    sql = {
      query: (text, values) => pool.query(text, values),
      async transaction(work) {
        const client = await pool.connect();
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
      },
    };
    cleanup = async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    };
    for (const file of (await readdir('migrations')).sort())
      await sql.query(await readFile(`migrations/${file}`, 'utf8'));
  } else {
    const db = new PGlite();
    const wrap = (database: Pick<PGlite, 'query'>): SqlClient => ({
      async query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
        return { rows: (await database.query<T>(text, values)).rows };
      },
    });
    sql = { ...wrap(db), transaction: (work) => db.transaction((tx) => work(wrap(tx))) };
    cleanup = () => db.close();
    for (const file of (await readdir('migrations')).sort())
      await db.exec(await readFile(`migrations/${file}`, 'utf8'));
  }
  await seedCatalog(sql, 'https://assets.example');
  members = (
    await sql.query<{ id: string; category: string; legacyId: string }>(
      `SELECT m.id,c.code AS category,m.legacy_id AS "legacyId" FROM materials m JOIN material_categories c ON c.id=m.category_id ORDER BY c.sort_order,m.sort_order`,
    )
  ).rows;
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  const publicKey = await exportJWK(keys.publicKey);
  publicKey.kid = 'test-key';
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG)
    .useValue(config)
    .overrideProvider(SQL)
    .useValue(sql)
    .overrideProvider(GOOGLE_VERIFY)
    .useValue(createGoogleVerifier(config, createLocalJWKSet({ keys: [publicKey] })))
    .compile();
  app = module.createNestApplication({ bodyParser: false, logger: false });
  await configureApp(app, config);
});
after(async () => {
  if (app) await app.close();
  if (cleanup) await cleanup();
});
beforeEach(async () => {
  await sql.query(
    'TRUNCATE design_requests,payments,invoices,orders,quotes,sessions,auth_challenges,users,admin_audit_log CASCADE',
  );
  await sql.query(
    `UPDATE materials SET price_vnd=NULL,unit=NULL,availability='inquiry',published=true,revision=1`,
  );
  await sql.query(`UPDATE products SET price_vnd=NULL,published=false,availability='inquiry'`);
  await sql.query(
    'UPDATE pricing_policy SET labour_bps=NULL,deposit_bps=NULL,quantity_mode=NULL,shipping_mode=NULL,revision=1',
  );
});
const server = () => app.getHttpServer();
const ids = (category: string) => members.filter((m) => m.category === category).map((m) => m.id);
async function login(admin = false) {
  const sub = String(++subject);
  const challenge = await request(server()).post('/v1/auth/challenge').expect(200);
  const token = await new SignJWT({
    email: `u${sub}@gmail.com`,
    email_verified: true,
    name: `User ${sub}`,
    nonce: challenge.body.nonce,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(sub)
    .setAudience(config.googleClientId!)
    .setIssuer('https://accounts.google.com')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);
  const response = await request(server())
    .post('/v1/auth/google')
    .send({ idToken: token, challengeId: challenge.body.challengeId })
    .expect(200);
  if (admin) await sql.query(`UPDATE users SET role='admin' WHERE id=$1`, [response.body.user.id]);
  return {
    token: response.body.accessToken as string,
    userId: response.body.user.id as string,
    idToken: token,
    challengeId: challenge.body.challengeId as string,
  };
}
async function configurePricing(adminToken: string) {
  await request(server())
    .patch('/v1/admin/pricing')
    .auth(adminToken, { type: 'bearer' })
    .set('If-Match', '1')
    .send({
      labourBps: 5000,
      depositBps: 5000,
      quantityMode: 'per_selection',
      shippingMode: 'separate',
      deliveryAreaCodes: ['HCM'],
    })
    .expect(200);
  await sql.query(
    `UPDATE materials SET price_vnd=CASE WHEN category_id=(SELECT id FROM material_categories WHERE code='glass') THEN 100000 ELSE 10000 END,unit='portion',availability='available'`,
  );
}
function quote(token: string, mossCount = 3) {
  return request(server())
    .post('/v1/quotes')
    .auth(token, { type: 'bearer' })
    .send({
      kind: 'custom',
      items: [ids('glass')[0], ...ids('moss').slice(0, mossCount)].map((materialId) => ({
        materialId,
        quantity: 1,
      })),
    });
}
const orderInput = (quoteId: string) => ({
  quoteId,
  recipientName: 'Test customer',
  phone: '0901234567',
  fulfillment: 'pickup',
});

test('public catalog reflects FE assets/rules, leaves unknown prices null and hides draft products', async () => {
  const categories = await request(server()).get('/v1/material-categories').expect(200);
  assert.equal(categories.body.find((c: { code: string }) => c.code === 'moss').maxSelections, 3);
  const moss = await request(server()).get('/v1/materials?category=moss').expect(200);
  assert.equal(moss.body.items.length, 7);
  assert.equal(moss.body.items[0].priceVnd, null);
  assert.match(moss.body.items[0].imageUrl, /^https:\/\/assets.example\/assets\/materials\/moss\//);
  assert.match(moss.headers['cache-control']!, /s-maxage=60/);
  assert.match(moss.headers['x-request-id']!, /^[0-9a-f-]{36}$/);
  await request(server()).get('/v1/content/about').expect(200);
  const products = await request(server()).get('/v1/products').expect(200);
  assert.equal(products.body.items.length, 0);
  await request(server()).get('/v1/products/reu-nho').expect(404);
});

test('pagination is bounded and cannot repeat the first page; input validation rejects unknown fields', async () => {
  const first = await request(server()).get('/v1/materials?limit=2').expect(200);
  const next = await request(server())
    .get(`/v1/materials?limit=2&cursor=${first.body.nextCursor}`)
    .expect(200);
  assert.notEqual(first.body.items[0].id, next.body.items[0].id);
  await request(server()).get('/v1/materials?limit=101').expect(400);
  await request(server()).get('/v1/materials?cursor=not-a-cursor').expect(400);
  await request(server()).get('/v1/materials?unexpected=1').expect(400);
  const docs = await request(server()).get('/openapi.json').expect(200);
  assert.ok(docs.body.paths['/v1/orders']);
  assert.ok(docs.body.components.schemas.DesignRequestDto.properties.phone);
  assert.ok(docs.body.components.schemas.DesignRequestDto.properties.materialIds);
  assert.deepEqual(docs.body.paths['/v1/design-requests'].post.tags, ['Design requests']);
  assert.deepEqual(docs.body.paths['/v1/design-requests'].post.security, [{ guest: [] }]);
  assert.ok(
    docs.body.paths['/v1/design-requests'].post.parameters.some(
      (parameter: { name: string }) => parameter.name === 'Idempotency-Key',
    ),
  );

  await request(server()).get('/health/live').expect(200);
  await request(server()).get('/health/ready').expect(200);
});

test('server selection validation enforces one glass, max three moss, and unique active IDs', async () => {
  const selected = [ids('glass')[0], ...ids('moss').slice(0, 3), ...ids('gravel')];
  await request(server())
    .post('/v1/configurations/validate')
    .send({ materialIds: selected })
    .expect(200);
  await request(server())
    .post('/v1/configurations/validate')
    .send({ materialIds: [...selected, ids('moss')[3]] })
    .expect(422);
  await request(server())
    .post('/v1/configurations/validate')
    .send({ materialIds: ids('moss').slice(0, 1) })
    .expect(422);
  await request(server())
    .post('/v1/configurations/validate')
    .send({ materialIds: [selected[0], selected[0]] })
    .expect(400);
  await request(server())
    .post('/v1/configurations/validate')
    .send({ materialIds: [randomUUID()] })
    .expect(400);
  await request(server())
    .post('/v1/configurations/validate')
    .send({ materialIds: selected, totalVnd: 1 })
    .expect(400);
});

test('Google login consumes nonce once, profile persists by Google sub, session revocation is effective', async () => {
  const user = await login();
  await request(server())
    .post('/v1/auth/google')
    .send({ idToken: user.idToken, challengeId: user.challengeId })
    .expect(401);
  const me = await request(server())
    .get('/v1/auth/me')
    .auth(user.token, { type: 'bearer' })
    .expect(200);
  assert.equal(me.body.id, user.userId);
  await request(server()).get('/v1/auth/me').auth('invalid', { type: 'bearer' }).expect(401);
  const malformed = user.idToken.slice(0, -8) + 'AAAAAAAA';
  await request(server())
    .post('/v1/auth/google')
    .send({ idToken: malformed, challengeId: user.challengeId })
    .expect(401);
  const stored = (await sql.query('SELECT token_hash FROM sessions')).rows[0]!.token_hash;
  assert.notEqual(stored, user.token);
  await request(server()).post('/v1/auth/logout').auth(user.token, { type: 'bearer' }).expect(200);
  await request(server()).get('/v1/auth/me').auth(user.token, { type: 'bearer' }).expect(401);
});

test('admin writes require an active admin, optimistic revision, valid money and unit; audit is atomic', async () => {
  const user = await login();
  const admin = await login(true);
  const id = ids('moss')[0]!;
  await request(server()).patch(`/v1/admin/materials/${id}`).send({ name: 'No' }).expect(401);
  await request(server())
    .patch(`/v1/admin/materials/${id}`)
    .auth(user.token, { type: 'bearer' })
    .set('If-Match', '1')
    .send({ name: 'No' })
    .expect(403);
  await request(server())
    .patch(`/v1/admin/materials/${id}`)
    .auth(admin.token, { type: 'bearer' })
    .set('If-Match', '1')
    .send({ priceVnd: 10000 })
    .expect(400);
  await request(server())
    .patch(`/v1/admin/materials/${id}`)
    .auth(admin.token, { type: 'bearer' })
    .set('If-Match', '1')
    .send({ priceVnd: 10000, unit: 'portion' })
    .expect(200);
  await request(server())
    .patch(`/v1/admin/materials/${id}`)
    .auth(admin.token, { type: 'bearer' })
    .set('If-Match', '1')
    .send({ priceVnd: 20000 })
    .expect(409);
  const audit = await sql.query(`SELECT action FROM admin_audit_log WHERE entity_id=$1`, [id]);
  assert.equal(audit.rows.length, 1);
});

test('quotes refuse unconfigured pricing, calculate from DB, reject tampering and enforce moss cap', async () => {
  const user = await login();
  const admin = await login(true);
  await quote(user.token).expect(503);
  await configurePricing(admin.token);
  const result = await quote(user.token).expect(201);
  assert.equal(result.body.subtotalVnd, 130000);
  assert.equal(result.body.labourVnd, 65000);
  assert.equal(result.body.totalVnd, 195000);
  assert.equal(result.body.depositVnd, 97500);
  await quote(user.token, 4).expect(422);
  await request(server())
    .post('/v1/quotes')
    .auth(user.token, { type: 'bearer' })
    .send({ kind: 'custom', items: [{ materialId: ids('glass')[0], quantity: 2 }] })
    .expect(400);
  await request(server())
    .post('/v1/quotes')
    .auth(user.token, { type: 'bearer' })
    .send({ kind: 'custom', items: [{ materialId: ids('glass')[0], quantity: 1 }], totalVnd: 1 })
    .expect(400);
});

test('50% labour and 50% deposit round fractions of one dong up deterministically', async () => {
  const user = await login();
  const admin = await login(true);
  await configurePricing(admin.token);
  await sql.query(`UPDATE materials SET price_vnd=100001 WHERE id=$1`, [ids('glass')[0]]);
  const first = await quote(user.token, 0).expect(201);
  assert.equal(first.body.labourVnd, 50001);
  assert.equal(first.body.totalVnd, 150002);
  assert.equal(first.body.depositVnd, 75001);
  await sql.query(`UPDATE materials SET price_vnd=100002 WHERE id=$1`, [ids('glass')[0]]);
  const second = await quote(user.token, 0).expect(201);
  assert.equal(second.body.totalVnd, 150003);
  assert.equal(second.body.depositVnd, 75002);
});

test('orders are idempotent, owner-isolated and produce an immutable order-summary invoice', async () => {
  const admin = await login(true);
  const buyer = await login();
  const other = await login();
  await configurePricing(admin.token);
  const priced = await quote(buyer.token).expect(201);
  const key = randomUUID();
  const body = orderInput(priced.body.id);
  const created = await request(server())
    .post('/v1/orders')
    .auth(buyer.token, { type: 'bearer' })
    .set('Idempotency-Key', key)
    .send(body)
    .expect(201);
  const replay = await request(server())
    .post('/v1/orders')
    .auth(buyer.token, { type: 'bearer' })
    .set('Idempotency-Key', key)
    .send(body)
    .expect(201);
  assert.equal(created.body.id, replay.body.id);
  await request(server())
    .post('/v1/orders')
    .auth(buyer.token, { type: 'bearer' })
    .set('Idempotency-Key', key)
    .send({ ...body, note: 'changed' })
    .expect(409);
  const invoice = await request(server())
    .get(`/v1/orders/${created.body.id}/invoice`)
    .auth(buyer.token, { type: 'bearer' })
    .expect(200);
  assert.equal(invoice.body.snapshot.totalVnd, 195000);
  await sql.query(`UPDATE materials SET price_vnd=999999 WHERE id=$1`, [ids('moss')[0]]);
  const preserved = await request(server())
    .get(`/v1/orders/${created.body.id}/invoice`)
    .auth(buyer.token, { type: 'bearer' })
    .expect(200);
  assert.equal(preserved.body.snapshot.totalVnd, 195000);
  await request(server())
    .get(`/v1/orders/${created.body.id}`)
    .auth(other.token, { type: 'bearer' })
    .expect(404);
  await request(server())
    .get(`/v1/orders/${created.body.id}/invoice`)
    .auth(other.token, { type: 'bearer' })
    .expect(404);
});

test('stale catalog and expired quotes cannot be checked out', async () => {
  const buyer = await login();
  const admin = await login(true);
  await configurePricing(admin.token);
  const priced = await quote(buyer.token).expect(201);
  await sql.query('UPDATE materials SET revision=revision+1 WHERE id=$1', [ids('moss')[0]]);
  await request(server())
    .post('/v1/orders')
    .auth(buyer.token, { type: 'bearer' })
    .set('Idempotency-Key', randomUUID())
    .send(orderInput(priced.body.id))
    .expect(409);
  const expired = await quote(buyer.token).expect(201);
  await sql.query(`UPDATE quotes SET expires_at=now()-interval '1 minute' WHERE id=$1`, [
    expired.body.id,
  ]);
  await request(server())
    .post('/v1/orders')
    .auth(buyer.token, { type: 'bearer' })
    .set('Idempotency-Key', randomUUID())
    .send(orderInput(expired.body.id))
    .expect(409);
});

test('manual payments cannot duplicate a bank reference, overpay, or complete an unpaid order', async () => {
  const buyer = await login();
  const admin = await login(true);
  await configurePricing(admin.token);
  const priced = await quote(buyer.token).expect(201);
  const order = await request(server())
    .post('/v1/orders')
    .auth(buyer.token, { type: 'bearer' })
    .set('Idempotency-Key', randomUUID())
    .send(orderInput(priced.body.id))
    .expect(201);
  const path = `/v1/admin/orders/${order.body.id}`;
  await request(server())
    .patch(`${path}/status`)
    .auth(admin.token, { type: 'bearer' })
    .send({ status: 'building' })
    .expect(409);
  await request(server())
    .post(`${path}/payments`)
    .auth(admin.token, { type: 'bearer' })
    .send({ amountVnd: 97500, reference: 'VCB:TEST1' })
    .expect(201);
  await request(server())
    .post(`${path}/payments`)
    .auth(admin.token, { type: 'bearer' })
    .send({ amountVnd: 97500, reference: 'VCB:TEST1' })
    .expect(201);
  const count = await sql.query('SELECT count(*)::int AS count FROM payments');
  assert.equal(count.rows[0]!.count, 1);
  await request(server())
    .post(`${path}/payments`)
    .auth(admin.token, { type: 'bearer' })
    .send({ amountVnd: 100000, reference: 'VCB:TEST2' })
    .expect(422);
  await request(server())
    .patch(`${path}/status`)
    .auth(admin.token, { type: 'bearer' })
    .send({ status: 'building' })
    .expect(200);
  await request(server())
    .patch(`${path}/status`)
    .auth(admin.token, { type: 'bearer' })
    .send({ status: 'ready' })
    .expect(200);
  await request(server())
    .patch(`${path}/status`)
    .auth(admin.token, { type: 'bearer' })
    .send({ status: 'completed' })
    .expect(409);
  await request(server())
    .post(`${path}/payments`)
    .auth(admin.token, { type: 'bearer' })
    .send({ amountVnd: 97500, reference: 'VCB:TEST2' })
    .expect(201);
  await request(server())
    .patch(`${path}/status`)
    .auth(admin.token, { type: 'bearer' })
    .send({ status: 'completed' })
    .expect(200);
});

test('production configuration forbids insecure database TLS and wildcard CORS', () => {
  assert.throws(() =>
    loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pw@db.example/db',
      PG_SSL: 'disable',
    }),
  );
  assert.throws(() =>
    loadConfig({ DATABASE_URL: 'postgresql://user:pw@db.example/db', CORS_ORIGINS: '*' }),
  );
});

test('admin catalog create/publish and About editing are protected; product quote adds no custom labour', async () => {
  const admin = await login(true);
  const buyer = await login();
  await configurePricing(admin.token);
  const productInput = {
    slug: 'test-ready-product',
    name: 'Test ready-made product',
    images: [{ url: 'https://assets.example/product.png', alt: 'Test' }],
    priceVnd: 500000,
    published: true,
    availability: 'available',
  };
  await request(server())
    .post('/v1/admin/products')
    .auth(buyer.token, { type: 'bearer' })
    .send(productInput)
    .expect(403);
  const created = await request(server())
    .post('/v1/admin/products')
    .auth(admin.token, { type: 'bearer' })
    .send(productInput)
    .expect(201);
  const publicProduct = await request(server()).get('/v1/products/test-ready-product').expect(200);
  assert.equal(publicProduct.body.priceVnd, 500000);
  const productQuote = await request(server())
    .post('/v1/quotes')
    .auth(buyer.token, { type: 'bearer' })
    .send({ kind: 'product', productId: created.body.id, quantity: 2 })
    .expect(201);
  assert.equal(productQuote.body.totalVnd, 1000000);
  assert.equal(productQuote.body.labourVnd, 0);
  await request(server())
    .patch(`/v1/admin/products/${created.body.id}`)
    .auth(admin.token, { type: 'bearer' })
    .set('If-Match', '1')
    .send({ name: 'Changed product' })
    .expect(200);
  await request(server())
    .post('/v1/orders')
    .auth(buyer.token, { type: 'bearer' })
    .set('Idempotency-Key', randomUUID())
    .send(orderInput(productQuote.body.id))
    .expect(409);
  const portfolio = await request(server())
    .post('/v1/admin/portfolio')
    .auth(admin.token, { type: 'bearer' })
    .send({
      name: 'Test composition',
      slug: 'test-portfolio',
      images: [{ url: '/assets/example.png', alt: 'Test' }],
      published: true,
    })
    .expect(201);
  assert.ok(portfolio.body.id);
  const about = await request(server())
    .patch('/v1/admin/content/about')
    .auth(admin.token, { type: 'bearer' })
    .send({ title: 'Updated story', eyebrow: 'Terralá', paragraphs: ['A story'] })
    .expect(200);
  assert.equal(about.body.key, 'about');
  const story = await request(server()).get('/v1/content/about').expect(200);
  assert.equal(story.body.data.title, 'Updated story');
  await request(server())
    .post('/v1/admin/materials')
    .auth(admin.token, { type: 'bearer' })
    .send({
      category: 'moss',
      legacyId: 'test-new',
      slug: 'test-new-moss',
      name: 'New moss',
      published: false,
    })
    .expect(201);
});

test('parallel retries create one order and one invoice; private lists are paginated', async () => {
  const admin = await login(true);
  const buyer = await login();
  await configurePricing(admin.token);
  const priced = await quote(buyer.token).expect(201);
  const key = randomUUID();
  const send = () =>
    request(server())
      .post('/v1/orders')
      .auth(buyer.token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(orderInput(priced.body.id));
  const [one, two] = await Promise.all([send(), send()]);
  assert.equal(one.status, 201);
  assert.equal(two.status, 201);
  assert.equal(one.body.id, two.body.id);
  const count = (await sql.query('SELECT count(*)::int AS count FROM invoices')).rows[0]!.count;
  assert.equal(count, 1);
  const list = await request(server())
    .get('/v1/orders?limit=1')
    .auth(buyer.token, { type: 'bearer' })
    .expect(200);
  assert.equal(list.body.items.length, 1);
  await request(server())
    .get('/v1/orders?limit=101')
    .auth(buyer.token, { type: 'bearer' })
    .expect(400);
});

test('malformed JSON/oversized bodies are client errors and seed reruns never reset edited prices', async () => {
  await request(server())
    .post('/v1/configurations/validate')
    .set('Content-Type', 'application/json')
    .send('{bad-json')
    .expect(400);
  await request(server())
    .post('/v1/configurations/validate')
    .send({ large: 'x'.repeat(40000) })
    .expect(413);
  await sql.query(`UPDATE materials SET price_vnd=12345,unit='portion' WHERE id=$1`, [
    ids('moss')[0],
  ]);
  await seedCatalog(sql, 'https://another.example');
  const price = (await sql.query('SELECT price_vnd FROM materials WHERE id=$1', [ids('moss')[0]]))
    .rows[0]!.price_vnd;
  assert.equal(price, 12345);
});

const guestToken = 'a'.repeat(64);
const guestInput = () => ({
  materialIds: [ids('glass')[0], ids('moss')[0]],
  recipientName: 'Khách kiểm thử',
  phone: '0901234567',
  area: 'Thủ Đức',
  note: 'Bố cục rừng',
});
function inquire(key: string, body = guestInput(), token = guestToken) {
  return request(server())
    .post('/v1/design-requests')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send(body);
}
test('guest inquiry works without prices/login, retries are idempotent and contacts are private', async () => {
  const key = randomUUID();
  const created = await inquire(key).expect(201);
  const retry = await inquire(key).expect(201);
  assert.equal(created.body.id, retry.body.id);
  await inquire(key, { ...guestInput(), note: 'changed' }).expect(409);
  const stored = (await sql.query('SELECT guest_hash FROM design_requests')).rows[0];
  assert.notEqual(stored!.guest_hash, guestToken);
  const own = await request(server())
    .get(`/v1/design-requests/${created.body.id}`)
    .auth(guestToken, { type: 'bearer' })
    .expect(200);
  const originalGlass = (await sql.query<{name:string}>('SELECT name FROM materials WHERE id=$1',[ids('glass')[0]])).rows[0]!.name;
  assert.equal(own.body.selection[0].name, originalGlass);
  assert.equal(own.body.contact, undefined);
  await request(server())
    .get(`/v1/design-requests/${created.body.id}`)
    .auth('b'.repeat(64), { type: 'bearer' })
    .expect(404);
  await request(server()).get(`/v1/design-requests/${created.body.id}`).expect(401);
  await sql.query(`UPDATE materials SET availability='unavailable' WHERE id=$1`, [ids('glass')[0]]);
  await inquire(key).expect(201); // A lost response remains recoverable after catalog changes.
  assert.equal(
    (await sql.query('SELECT count(*)::int AS count FROM design_requests')).rows[0]!.count,
    1,
  );
});
test('guest inquiry validates live selection, phone/date and unknown price fields', async () => {
  await inquire(randomUUID(), { ...guestInput(), phone: 'wrong' }).expect(400);
  await inquire(randomUUID(), { ...guestInput(), recipientName: '  ' }).expect(400);
  await inquire(randomUUID(), { ...guestInput(), materialIds: ids('moss').slice(0, 4) }).expect(
    422,
  );
  await inquire(randomUUID(), {
    ...guestInput(),
    materialIds: [ids('glass')[0], ids('glass')[0]],
  }).expect(400);
  await inquire(randomUUID(), { ...guestInput(), totalVnd: 1 } as ReturnType<
    typeof guestInput
  >).expect(400);
  await inquire(randomUUID(), { ...guestInput(), preferredDate: '2026-99-99' } as ReturnType<
    typeof guestInput
  >).expect(400);
});
test('concurrent guest submissions deduplicate; inquiry admin actions require role and revision', async () => {
  const key = randomUUID();
  const results = await Promise.all([inquire(key), inquire(key)]);
  assert.ok(results.every((result) => result.status === 201));
  assert.equal(results[0]!.body.id, results[1]!.body.id);
  const id = results[0]!.body.id;
  const admin = await login(true);
  const customer = await login();
  await request(server()).get('/v1/admin/design-requests').expect(401);
  await request(server())
    .get('/v1/admin/design-requests')
    .auth(customer.token, { type: 'bearer' })
    .expect(403);
  const list = await request(server())
    .get('/v1/admin/design-requests')
    .auth(admin.token, { type: 'bearer' })
    .expect(200);
  assert.equal(list.body.items[0].contact.phone, '0901234567');
  const patch = () =>
    request(server())
      .patch(`/v1/admin/design-requests/${id}`)
      .auth(admin.token, { type: 'bearer' })
      .set('If-Match', '1')
      .send({ status: 'contacted' });
  await patch().expect(200);
  await patch().expect(409);
  const receipt = await request(server())
    .get(`/v1/design-requests/${id}`)
    .auth(guestToken, { type: 'bearer' })
    .expect(200);
  assert.equal(receipt.body.status, 'contacted');
});
test('guest intake is bounded per guest and paginated for admin', async () => {
  for (let i = 0; i < 5; i++) await inquire(randomUUID()).expect(201);
  await inquire(randomUUID()).expect(429);
  const admin = await login(true);
  const first = await request(server())
    .get('/v1/admin/design-requests?limit=2')
    .auth(admin.token, { type: 'bearer' })
    .expect(200);
  const second = await request(server())
    .get(`/v1/admin/design-requests?limit=2&cursor=${first.body.nextCursor}`)
    .auth(admin.token, { type: 'bearer' })
    .expect(200);
  assert.notEqual(first.body.items[0].id, second.body.items[0].id);
});

test('design presets include a complete editable recipe, preserve seed edits, and disable invalid recipes', async () => {
  const response = await request(server()).get('/v1/design-presets?limit=1').expect(200);
  const preset = response.body.items.find((item: { slug: string }) => item.slug === 'attempt-1');
  assert.ok(preset);
  assert.equal(preset.selectable, true);
  assert.equal(preset.isDemo, true);
  assert.equal(preset.materials.length, 8);
  assert.equal(
    preset.materials.find((item: { category: string }) => item.category === 'glass').legacyId,
    'vertical-rectangle',
  );
  assert.ok(preset.imageUrl.endsWith('/assets/products/attempt-1.jpg'));
  await request(server())
    .post('/v1/configurations/validate')
    .send({ materialIds: preset.materials.map((item: { id: string }) => item.id) })
    .expect(200);
  const chosen = preset.materials.find((item: { category: string }) => item.category === 'moss');
  try {
    await sql.query(`UPDATE materials SET availability='unavailable' WHERE id=$1`, [chosen.id]);
    const unavailable = await request(server()).get('/v1/design-presets').expect(200);
    assert.equal(unavailable.body.items[0].selectable, false);
    assert.deepEqual(unavailable.body.items[0].materials, []);
    await sql.query(`UPDATE materials SET availability='inquiry',published=false WHERE id=$1`, [
      chosen.id,
    ]);
    const hidden = await request(server()).get('/v1/design-presets').expect(200);
    assert.equal(hidden.body.items[0].selectable, false);
    await sql.query(`UPDATE materials SET published=true WHERE id=$1`, [chosen.id]);
    await sql.query(`UPDATE design_presets SET name='Edited preset' WHERE id=$1`, [preset.id]);
    await seedCatalog(sql, 'https://assets.example');
    const preserved = await request(server()).get('/v1/design-presets').expect(200);
    assert.equal(preserved.body.items.length, 1);
    assert.equal(preserved.body.items[0].name, 'Edited preset');
    assert.equal(preserved.body.items[0].materials.length, 8);
    await sql.query(`UPDATE design_presets SET published=false WHERE id=$1`, [preset.id]);
    const drafts = await request(server()).get('/v1/design-presets').expect(200);
    assert.equal(drafts.body.items.length, 0);
  } finally {
    await sql.query(`UPDATE materials SET availability='inquiry',published=true WHERE id=$1`, [
      chosen.id,
    ]);
    await sql.query(`UPDATE design_presets SET name=$2,published=true WHERE id=$1`, [
      preset.id,
      preset.name,
    ]);
  }
});

test('explicit display sync updates API catalog without duplicate IDs or changing prices, stock, publish flags or recipes', async () => {
  const before = await request(server()).get('/v1/materials?limit=100').expect(200);
  const soil = before.body.items.find(
    (item: { category: string; legacyId: string }) =>
      item.category === 'soil' && item.legacyId === 'potting',
  );
  const countBefore = (await sql.query<{ count: string }>('SELECT count(*) FROM materials'))
    .rows[0]!.count;
  await sql.query(
    `UPDATE materials SET name='old name',image_url=NULL,price_vnd=12345,unit='phần',availability='unavailable',published=false WHERE id=$1`,
    [soil.id],
  );
  await seedCatalog(sql, 'https://assets.example', true);
  const synced = (
    await sql.query<{
      id: string;
      name: string;
      image_url: string;
      price_vnd: number;
      availability: string;
      published: boolean;
      revision: number;
    }>('SELECT * FROM materials WHERE id=$1', [soil.id])
  ).rows[0];
  assert.ok(synced);
  assert.equal(synced.id, soil.id);
  assert.equal(synced.name, 'Đất nền');
  assert.equal(synced.image_url, 'https://assets.example/assets/materials/dat-nen.png');
  assert.equal(synced.price_vnd, 12345);
  assert.equal(synced.availability, 'unavailable');
  assert.equal(synced.published, false);
  await seedCatalog(sql, 'https://assets.example', true);
  assert.equal(
    (await sql.query<{ revision: number }>('SELECT revision FROM materials WHERE id=$1', [soil.id]))
      .rows[0]!.revision,
    synced.revision,
  );
  assert.equal(
    (await sql.query<{ count: string }>('SELECT count(*) FROM materials')).rows[0]!.count,
    countBefore,
  );
  await sql.query(`UPDATE materials SET published=true,availability='inquiry' WHERE id=$1`, [
    soil.id,
  ]);
  const all = await request(server()).get('/v1/materials?limit=100').expect(200);
  const expected = JSON.parse(await readFile('scripts/catalog-seed.json', 'utf8')) as {
    code: string;
    materials: {
      legacyId: string;
      name: string;
      description: string;
      imageUrl: string | null;
      sortOrder: number;
    }[];
  }[];
  for (const group of expected)
    for (const item of group.materials) {
      const row = all.body.items.find(
        (value: { category: string; legacyId: string }) =>
          value.category === group.code && value.legacyId === item.legacyId,
      );
      assert.ok(row);
      assert.equal(row.name, item.name);
      assert.equal(row.description, item.description);
      assert.equal(row.imageUrl, item.imageUrl ? `https://assets.example${item.imageUrl}` : null);
      assert.equal(row.sortOrder, item.sortOrder);
    }
  const preset = await request(server()).get('/v1/design-presets').expect(200);
  assert.equal(
    preset.body.items[0].materials.find((item: { id: string }) => item.id === soil.id).name,
    'Đất nền',
  );
});
