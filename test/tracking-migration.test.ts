import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('tracking migration preserves old numbers/UUIDs and backfills only the known status', async () => {
  const db = new PGlite();
  try {
    for (const file of (await readdir('migrations')).sort().filter((file) => file < '017'))
      await db.exec(await readFile(`migrations/${file}`, 'utf8'));
    const id = randomUUID();
    const number = `TL-${id.toUpperCase()}`;
    await db.query(
      `INSERT INTO design_requests(id,number,guest_hash,idempotency_key,request_hash,selection,contact,status)
      VALUES($1,$2,repeat('a',64),gen_random_uuid(),repeat('b',64),'[]','{}','contacted')`,
      [id, number],
    );
    await db.exec(await readFile('migrations/017_tracking_feedback.sql', 'utf8'));
    const row = (
      await db.query<{ id: string; number: string; tracking_code: string }>(
        'SELECT id,number,tracking_code FROM design_requests',
      )
    ).rows[0]!;
    assert.equal(row.id, id);
    assert.equal(row.number, number);
    assert.match(row.tracking_code, /^[A-F0-9]{8}$/);
    const events = await db.query<{ status: string }>(
      'SELECT status FROM request_status_events WHERE request_id=$1',
      [id],
    );
    assert.deepEqual(
      events.rows.map((row) => row.status),
      ['contacted'],
    );
  } finally {
    await db.close();
  }
});
