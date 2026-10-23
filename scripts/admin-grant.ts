import 'reflect-metadata';
import { loadConfig } from '../src/common/config.js';
import { createPool } from '../src/database/database.service.js';
const subject = process.argv[2];
if (!subject || !/^[0-9]{1,40}$/.test(subject))
  throw new Error('Usage: npm run admin:grant -- <verified Google sub of an existing user>');
const pool = createPool(loadConfig());
try {
  const result = await pool.query(
    `UPDATE users SET role='admin' WHERE google_sub=$1 AND active RETURNING id`,
    [subject],
  );
  if (!result.rows.length)
    throw new Error('No active Google account found; log in before granting admin');
  console.log('Administrator role granted to the existing verified account.');
} finally {
  await pool.end();
}
