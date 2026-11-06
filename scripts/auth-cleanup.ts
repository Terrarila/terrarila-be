import 'reflect-metadata';
import { loadConfig } from '../src/common/config.js';
import { createPool } from '../src/database/database.service.js';

const pool = createPool({ ...loadConfig(), poolMax: 1 });
try {
  await pool.query(`DELETE FROM public_request_limits WHERE key_hash IN
    (SELECT key_hash FROM public_request_limits WHERE expires_at<now() LIMIT 5000)`);
  const limits = await pool.query(`DELETE FROM auth_login_limits WHERE key_hash IN
    (SELECT key_hash FROM auth_login_limits WHERE window_started < now() - interval '1 day' LIMIT 5000) RETURNING key_hash`);
  console.log(`auth_login_limits: removed ${limits.rowCount} expired records`);
  for (const table of ['auth_challenges', 'sessions'] as const) {
    // Closed table allowlist; bounded batches avoid an unbounded maintenance transaction.
    const result = await pool.query(
      `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table}
       WHERE expires_at < now() - interval '1 day'
       ${table === 'sessions' ? "OR revoked_at < now() - interval '1 day'" : ''}
       ORDER BY expires_at LIMIT 5000) RETURNING id`,
    );
    console.log(`${table}: removed ${result.rowCount} expired records`);
  }
} finally {
  await pool.end();
}
