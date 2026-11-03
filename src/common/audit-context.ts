import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

export const auditContext = new AsyncLocalStorage<{ requestId: string; ipHash: string }>();
export const hashedIp = (ip: string) => createHash('sha256').update(`audit-ip:${ip}`).digest('hex');
// Only call with whitelisted business fields, never credentials or arbitrary request bodies.
export function auditChanges(changes: object, before?: unknown) {
  return JSON.stringify({
    ...changes,
    ...(before !== undefined ? { _before: before } : {}),
    _context: auditContext.getStore() ?? null,
  });
}
