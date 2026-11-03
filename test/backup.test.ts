import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptArchive, decryptArchive, command } from '../scripts/operations/backup.js';
import { validateArchive } from '../scripts/operations/safe-archive.js';

test('backup encryption roundtrips and rejects modified ciphertext or wrong keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'petite-crypto-test-'));
  try {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const input = join(dir, 'input'),
      bundle = join(dir, 'bundle'),
      output = join(dir, 'output');
    await writeFile(input, 'private customer data');
    await encryptArchive(input, bundle, pair.publicKey);
    assert.ok(!(await readFile(bundle)).includes(Buffer.from('private customer data')));
    await decryptArchive(bundle, output, pair.privateKey);
    assert.equal(await readFile(output, 'utf8'), 'private customer data');
    const wrong = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await assert.rejects(decryptArchive(bundle, join(dir, 'wrong'), wrong.privateKey));
    const bytes = await readFile(bundle);
    bytes[bytes.length - 20] = bytes[bytes.length - 20]! ^ 1;
    await writeFile(bundle, bytes);
    await assert.rejects(decryptArchive(bundle, join(dir, 'tampered'), pair.privateKey));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('restore refuses archive symlinks before extraction', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'petite-tar-test-'));
  try {
    await writeFile(join(dir, 'database.dump'), 'fixture');
    await writeFile(join(dir, 'manifest.json'), '{}');
    await mkdir(join(dir, 'media'));
    await command(
      'tar',
      ['--format=ustar', '-cf', join(dir, 'valid.tar'), 'database.dump', 'manifest.json', 'media'],
      { cwd: dir },
    );
    await validateArchive(join(dir, 'valid.tar'));
    await symlink('/etc/passwd', join(dir, 'media', 'link'));
    await command(
      'tar',
      [
        '--format=ustar',
        '-cf',
        join(dir, 'invalid.tar'),
        'database.dump',
        'manifest.json',
        'media',
      ],
      { cwd: dir },
    );
    await assert.rejects(validateArchive(join(dir, 'invalid.tar')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
