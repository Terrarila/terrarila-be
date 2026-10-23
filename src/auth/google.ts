import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import type { AppConfig } from '../common/config.js';
export const GOOGLE_VERIFY = Symbol('GOOGLE_VERIFY');
export type GoogleVerifier = ((token: string) => Promise<JWTPayload>) | null;
export function createGoogleVerifier(config: AppConfig, keys?: JWTVerifyGetKey): GoogleVerifier {
  if (!config.googleClientId) return null;
  const resolver =
    keys ??
    createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
      timeoutDuration: 3000,
    });
  return async (token) =>
    (
      await jwtVerify(token, resolver, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: config.googleClientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat', 'email', 'nonce'],
      })
    ).payload;
}
