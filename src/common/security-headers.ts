import * as helmetModule from 'helmet';
import type { RequestHandler } from 'express';

export function createSecurityHeaders(module: unknown = helmetModule): RequestHandler {
  // ESM, CommonJS and transpiled imports can wrap the callable in `default`.
  // Inspect the runtime value instead of assuming a particular loader's types.
  let factory: unknown = module;
  for (let depth = 0; depth < 3 && typeof factory !== 'function'; depth++) {
    if (!factory || typeof factory !== 'object' || !('default' in factory)) break;
    factory = factory.default;
  }
  if (typeof factory !== 'function') throw new Error('Helmet export is not callable');
  const middleware: unknown = factory();
  if (typeof middleware !== 'function') throw new Error('Helmet middleware is not callable');
  return middleware as RequestHandler;
}
