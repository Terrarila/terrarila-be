import { open } from 'node:fs/promises';
// Accept only our simple ustar format: no links, traversal, devices, extensions or duplicate entries.
export async function validateArchive(file: string) {
  const handle = await open(file, 'r');
  try {
    const size = (await handle.stat()).size,
      names = new Set<string>();
    let offset = 0;
    while (offset + 512 <= size) {
      const block = Buffer.alloc(512);
      await handle.read(block, 0, 512, offset);
      if (block.every((byte) => byte === 0)) break;
      const text = (start: number, length: number) =>
        block.toString('utf8', start, start + length).replace(/\0.*$/s, '');
      const prefix = text(345, 155),
        name = (prefix ? prefix + '/' : '') + text(0, 100),
        type = text(156, 1);
      if (
        !/^(database\.dump|manifest\.json|media(?:\/.*)?)$/.test(name) ||
        name.startsWith('/') ||
        name.split('/').some((part) => part === '..' || part === '.') ||
        names.has(name) ||
        !['', '0', '5'].includes(type)
      )
        throw new Error('Unsafe archive entry');
      if (names.size >= 100000) throw new Error('Too many archive entries');
      names.add(name);
      const raw = text(124, 12).trim();
      if (!/^[0-7]+$/.test(raw)) throw new Error('Unsupported archive size');
      const length = parseInt(raw, 8);
      if (!Number.isSafeInteger(length) || offset + 512 + length > size)
        throw new Error('Truncated archive');
      offset += 512 + Math.ceil(length / 512) * 512;
    }
    if (
      !names.has('database.dump') ||
      !names.has('manifest.json') ||
      ![...names].some((name) => name === 'media/' || name === 'media')
    )
      throw new Error('Incomplete backup');
  } finally {
    await handle.close();
  }
}
