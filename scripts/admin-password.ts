import 'reflect-metadata';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { isEmail } from 'class-validator';
import { loadConfig } from '../src/common/config.js';
import { createPool } from '../src/database/database.service.js';
import { hashPassword } from '../src/auth/password.js';
import { saveAdminPassword } from '../src/auth/provision-admin.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !isEmail(email) || email.length > 254)
  throw new Error('Usage: npm run admin:password -- <email>');
if (!process.stdin.isTTY)
  throw new Error('Run in an interactive terminal; password is never an argument');
const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});
const terminal = createInterface({ input: process.stdin, output: silentOutput, terminal: true });
let password: string;
try {
  process.stdout.write('New password (15..128 characters, hidden): ');
  password = await terminal.question('');
  process.stdout.write('\nConfirm password (hidden): ');
  const confirm = await terminal.question('');
  process.stdout.write('\n');
  if (password !== confirm) throw new Error('Passwords do not match');
} finally {
  terminal.close();
}
const hash = await hashPassword(password);
const pool = createPool(loadConfig());
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await saveAdminPassword(client, email, hash);
  await client.query('COMMIT');
  console.log('Admin password saved. Previous sessions revoked.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
