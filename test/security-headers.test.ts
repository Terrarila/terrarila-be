import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import express from 'express';
import request from 'supertest';
import * as helmetModule from 'helmet';
import { createSecurityHeaders } from '../src/common/security-headers.js';

const require = createRequire(import.meta.url);
for (const [name, module] of [
  ['ESM namespace', helmetModule],
  ['CommonJS export', require('helmet') as unknown],
  ['nested default wrapper', { default: helmetModule }],
] as const) {
  test(`Helmet preserves security headers with ${name}`, async () => {
    const app = express();
    app.use(createSecurityHeaders(module));
    app.get('/', (_req, res) => res.json({ ok: true }));
    const response = await request(app).get('/').expect(200);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
    assert.ok(response.headers['content-security-policy']);
    assert.ok(response.headers['strict-transport-security']);
    assert.equal(response.headers['x-powered-by'], undefined);
  });
}

test('Helmet rejects invalid exports and middleware instead of dropping security headers', () => {
  assert.throws(() => createSecurityHeaders({ default: {} }), /export is not callable/);
  assert.throws(() => createSecurityHeaders(() => ({})), /middleware is not callable/);
});
