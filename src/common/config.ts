export const CONFIG = Symbol('CONFIG');
export type AppConfig = ReturnType<typeof loadConfig>;

function httpUrl(value: string, key: string, httpsOnly = false) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
  if (
    !(httpsOnly ? ['https:'] : ['https:', 'http:']).includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(`${key} has an unsupported URL`);
  return url;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const environment = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(environment))
    throw new Error('Invalid NODE_ENV');
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  let database: URL;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error('Invalid DATABASE_URL');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol))
    throw new Error('DATABASE_URL must use PostgreSQL');
  const ssl = env.PG_SSL ?? 'verify-full';
  if (!['disable', 'verify-full'].includes(ssl))
    throw new Error('PG_SSL must be disable or verify-full');
  if (ssl === 'disable' && environment === 'production')
    throw new Error('Production requires PG_SSL=verify-full');
  const poolMax = Number(env.DB_POOL_MAX ?? 5);
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 20)
    throw new Error('DB_POOL_MAX must be 1..20');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const corsOrigins = (env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of corsOrigins)
    if (httpUrl(origin, 'CORS_ORIGINS', environment === 'production').origin !== origin)
      throw new Error('CORS_ORIGINS must contain origins only');
  const assetBaseUrl = env.ASSET_BASE_URL
    ? httpUrl(env.ASSET_BASE_URL, 'ASSET_BASE_URL', environment === 'production')
        .toString()
        .replace(/\/$/, '')
    : null;
  const sessionTtlSeconds = Number(env.SESSION_TTL_SECONDS ?? 86400);
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 300 || sessionTtlSeconds > 604800)
    throw new Error('SESSION_TTL_SECONDS must be 300..604800');
  return {
    environment,
    databaseUrl,
    ssl: ssl as 'disable' | 'verify-full',
    poolMax,
    port,
    corsOrigins,
    assetBaseUrl,
    swaggerEnabled:
      env.SWAGGER_ENABLED === 'true' ||
      (env.SWAGGER_ENABLED === undefined && environment !== 'production'),
    googleClientId: env.GOOGLE_CLIENT_ID,
    sessionTtlSeconds,
  };
}
