import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP scrypt baseline: N=2^17, r=8, p=1; async to keep the event loop available.
const options = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
export function validateNewPassword(password: string) {
  if (password.length < 15 || password.length > 128)
    throw new Error('Password must contain 15..128 characters');
}
export async function hashPassword(password: string) {
  validateNewPassword(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$131072$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string | null) {
  const valid = encoded && /^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded);
  const parts = valid ? encoded.split('$') : null;
  // Missing accounts take the same expensive derivation path.
  const salt = parts ? Buffer.from(parts[4]!, 'hex') : Buffer.alloc(16);
  const expected = parts ? Buffer.from(parts[5]!, 'hex') : Buffer.alloc(64);
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && Boolean(valid);
}
