import 'reflect-metadata';
import { loadConfig } from '../src/common/config.js';
import { createPool } from '../src/database/database.service.js';
const subject = process.argv[2];
if (!subject || !/^[0-9]{1,40}$/.test(subject))
  throw new Error('Usage: npm run admin:grant -- <verified Google sub of an existing user>');
const pool = createPool(loadConfig());
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE users SET role='admin' WHERE google_sub=$1 AND active RETURNING id`,
      [subject],
    );
    if (!result.rows.length)
      throw new Error('No active Google account found; log in before granting admin');
    await client.query(
      `INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes)
      VALUES('operator:cli','admin.role_granted',$1,'{"role":"admin"}')`,
      [result.rows[0].id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  console.log('Administrator role granted to the existing verified account.');
} finally {
  await pool.end();
}
