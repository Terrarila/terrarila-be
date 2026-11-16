import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/common/config.js';
import { loadMailgunConfig } from '../src/notifications/mailgun.config.js';
import { MailDeliveryError, MailgunMailer } from '../src/notifications/mailgun.js';

const env = {
  MAILGUN_ENABLED: 'true',
  MAILGUN_DOMAIN: 'mg.example.com',
  MAILGUN_REGION: 'EU',
  MAILGUN_API_KEY: 'fixture-only',
  MAILGUN_FROM: 'shop@mg.example.com',
  MAILGUN_NOTIFY_TO: 'owner@example.com',
  ADMIN_APP_URL: 'https://admin.example.com',
};
const config = (overrides: Record<string, string> = {}) =>
  loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://fixture@localhost/test',
    PG_SSL: 'disable',
    ...env,
    ...overrides,
  });

test('Mailgun is opt-in and validates enabled configuration without exposing secrets', () => {
  assert.equal(loadMailgunConfig({}), null);
  assert.equal(loadMailgunConfig({ MAILGUN_ENABLED: 'false', MAILGUN_API_KEY: 'unused' }), null);
  for (const invalid of [
    { MAILGUN_ENABLED: 'yes' },
    { MAILGUN_API_KEY: '' },
    { MAILGUN_REGION: 'XX' },
    { MAILGUN_DOMAIN: 'https://evil.example/path' },
    { MAILGUN_FROM: 'shop@example.com\r\nBcc: other@example.com' },
    { MAILGUN_NOTIFY_TO: 'one@example.com,two@example.com' },
    { ADMIN_APP_URL: 'http://admin.example.com' },
    { ADMIN_APP_URL: 'https://user:secret@admin.example.com' },
    { ADMIN_APP_URL: 'https://admin.example.com/redirect' },
  ])
    assert.throws(() => loadMailgunConfig({ ...env, ...invalid }));
  const mail = loadMailgunConfig({ ...env, ADMIN_APP_URL: '' });
  assert.equal(mail!.adminUrl, null);
});

test('Mailgun sends multipart text to a fixed recipient using the configured region and no tracking', async (t) => {
  let calls = 0;
  let expectedOrigin = '';
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, `${expectedOrigin}/v3/mg.example.com/messages`);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(init.headers, {
      Authorization: `Basic ${Buffer.from('api:fixture-only').toString('base64')}`,
    });
    const body = init.body as FormData;
    assert.equal(body.get('to'), 'owner@example.com');
    assert.equal(body.get('from'), 'Petite Terre <shop@mg.example.com>');
    assert.equal(body.get('subject'), 'Fixture subject');
    assert.equal(body.get('text'), '<script>customer text</script>');
    assert.equal(body.get('html'), null);
    assert.equal(body.get('o:tracking'), 'no');
    return Response.json({ id: '<accepted@mg.example.com>', message: 'Queued' });
  });
  for (const [region, origin] of [
    ['US', 'https://api.mailgun.net'],
    ['EU', 'https://api.eu.mailgun.net'],
    ['AU', 'https://api.au.mailgun.net'],
  ]) {
    expectedOrigin = origin!;
    const id = await new MailgunMailer(config({ MAILGUN_REGION: region! })).send({
      subject: 'Fixture subject',
      text: '<script>customer text</script>',
    });
    assert.equal(id, '<accepted@mg.example.com>');
  }
  assert.equal(calls, 3);
});

test('Mailgun failures are classified without returning provider bodies or credentials', async (t) => {
  let response = new Response('sensitive-provider-detail', { status: 401 });
  let networkError = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (networkError) throw new Error('sensitive-network-detail');
    return response;
  });
  const mailer = new MailgunMailer(config());
  for (const [status, retryable] of [
    [400, false],
    [401, false],
    [403, false],
    [420, true],
    [429, true],
    [503, true],
  ] as const) {
    response = new Response('sensitive-provider-detail', { status });
    await assert.rejects(mailer.send({ subject: 'Fixture', text: 'Fixture' }), (error: unknown) => {
      assert.ok(error instanceof MailDeliveryError);
      assert.equal(error.message, `http_${status}`);
      assert.equal(error.retryable, retryable);
      return true;
    });
  }
  response = Response.json({ message: 'No id' });
  await assert.rejects(mailer.send({ subject: 'Fixture', text: 'Fixture' }), /invalid_response/);
  networkError = true;
  await assert.rejects(mailer.send({ subject: 'Fixture', text: 'Fixture' }), /network_or_timeout/);
  const disabled = new MailgunMailer(
    loadConfig({ DATABASE_URL: 'postgresql://fixture@localhost/test' }),
  );
  await assert.rejects(disabled.send({ subject: 'Fixture', text: 'Fixture' }), /disabled/);
});
