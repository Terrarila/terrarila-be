import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { isEmail } from 'class-validator';
import { DatabaseService } from '../database/database.service.js';
import { CONFIG } from '../common/config.js';
import type { AppConfig } from '../common/config.js';
import { GOOGLE_VERIFY } from './google.js';
import type { GoogleVerifier } from './google.js';
import { verifyPassword } from './password.js';

export type SessionUser = {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  role: 'customer' | 'admin';
};
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  private passwordChecks = 0;
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(GOOGLE_VERIFY) private readonly verify: GoogleVerifier,
  ) {}
  async passwordLogin(email: string, password: string, ip: string) {
    const normalized = email.trim().toLowerCase();
    const emailKey = tokenHash(`email:${normalized}`);
    const limits = await this.db.transaction(async (client) => {
      const results = [];
      for (const [key, maximum] of [
        [emailKey, 5],
        [tokenHash(`ip:${ip}`), 30],
      ] as const) {
        const row = (
          await client.query<{ attempts: number }>(
            `INSERT INTO auth_login_limits(key_hash) VALUES($1)
          ON CONFLICT(key_hash) DO UPDATE SET
          attempts=CASE WHEN auth_login_limits.window_started<now()-interval '15 minutes' THEN 1 ELSE auth_login_limits.attempts+1 END,
          window_started=CASE WHEN auth_login_limits.window_started<now()-interval '15 minutes' THEN now() ELSE auth_login_limits.window_started END
          RETURNING attempts`,
            [key],
          )
        ).rows[0]!;
        results.push(row.attempts <= maximum);
      }
      return results.every(Boolean);
    });
    if (!limits || this.passwordChecks >= 2)
      throw new HttpException('Too many login attempts; try again later', 429);
    this.passwordChecks++;
    try {
      const credential = (
        await this.db.query<{ userId: string; passwordHash: string }>(
          `SELECT c.user_id AS "userId",c.password_hash AS "passwordHash" FROM admin_credentials c
        JOIN users u ON u.id=c.user_id WHERE c.email=$1 AND u.active AND u.role='admin'`,
          [normalized],
        )
      ).rows[0];
      const valid = await verifyPassword(password, credential?.passwordHash ?? null);
      if (!valid || !credential) throw new UnauthorizedException('Invalid email or password');
      const accessToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + this.config.sessionTtlSeconds * 1000).toISOString();
      const user = await this.db.transaction(async (client) => {
        // Lock the current credential so a concurrent CLI reset cannot leave an old session valid.
        const row = (
          await client.query<SessionUser>(
            `SELECT u.id,u.email,u.username,u.avatar_url AS "avatarUrl",u.role FROM users u
          JOIN admin_credentials c ON c.user_id=u.id WHERE u.id=$1 AND u.active AND u.role='admin'
          AND c.password_hash=$2 FOR UPDATE OF u,c`,
            [credential.userId, credential.passwordHash],
          )
        ).rows[0];
        if (!row) throw new UnauthorizedException('Invalid email or password');
        await client.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)', [
          row.id,
          tokenHash(accessToken),
          expiresAt,
        ]);
        await client.query('UPDATE users SET last_login_at=now() WHERE id=$1', [row.id]);
        await client.query('DELETE FROM auth_login_limits WHERE key_hash=$1', [emailKey]);
        return row;
      });
      return { accessToken, tokenType: 'Bearer', expiresAt, user };
    } finally {
      this.passwordChecks--;
    }
  }
  async challenge() {
    if (!this.verify) throw new ServiceUnavailableException('Google login is not configured');
    const nonce = randomBytes(32).toString('base64url');
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO auth_challenges(nonce_hash,expires_at) VALUES($1,now()+interval '5 minutes') RETURNING id`,
      [tokenHash(nonce)],
    );
    return { challengeId: result.rows[0]!.id, nonce, expiresIn: 300 };
  }
  async login(idToken: string, challengeId: string) {
    if (!this.verify) throw new ServiceUnavailableException('Google login is not configured');
    let claims;
    try {
      claims = await this.verify(idToken);
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }
    if (
      !claims.sub ||
      typeof claims.email !== 'string' ||
      !isEmail(claims.email) ||
      claims.email_verified !== true ||
      typeof claims.nonce !== 'string'
    )
      throw new UnauthorizedException('Verified Google profile required');
    const username = (
      typeof claims.name === 'string' && claims.name.trim()
        ? claims.name
        : claims.email.split('@')[0]!
    ).slice(0, 120);
    const avatar =
      typeof claims.picture === 'string' && claims.picture.startsWith('https://')
        ? claims.picture.slice(0, 2048)
        : null;
    const accessToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.sessionTtlSeconds * 1000).toISOString();
    const result = await this.db.query<SessionUser>(
      `WITH consumed AS (
      UPDATE auth_challenges SET consumed_at=now() WHERE id=$1::uuid AND nonce_hash=$2 AND expires_at>now() AND consumed_at IS NULL RETURNING id
    ), person AS (
      INSERT INTO users(google_sub,email,username,avatar_url)
      SELECT $3,$4,$5,$6 FROM consumed
      ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,username=excluded.username,avatar_url=excluded.avatar_url,last_login_at=now()
      RETURNING id,email,username,avatar_url,role,active
    ), session AS (
      INSERT INTO sessions(user_id,token_hash,expires_at) SELECT id,$7,$8::timestamptz FROM person WHERE active RETURNING user_id
    ) SELECT p.id,p.email,p.username,p.avatar_url AS "avatarUrl",p.role FROM person p JOIN session s ON s.user_id=p.id`,
      [
        challengeId,
        tokenHash(claims.nonce),
        claims.sub,
        claims.email,
        username,
        avatar,
        tokenHash(accessToken),
        expiresAt,
      ],
    );
    if (!result.rows[0])
      throw new UnauthorizedException('Login challenge expired, already used, or account disabled');
    return { accessToken, tokenType: 'Bearer', expiresAt, user: result.rows[0] };
  }
  async authenticate(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException('Invalid session');
    const result = await this.db.query<SessionUser & { sessionId: string }>(
      `SELECT u.id,u.email,u.username,u.avatar_url AS "avatarUrl",u.role,s.id AS "sessionId" FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND u.active`,
      [tokenHash(token)],
    );
    if (!result.rows[0]) throw new UnauthorizedException('Session expired or revoked');
    return result.rows[0];
  }
  async logout(sessionId: string) {
    await this.db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [sessionId]);
    return { loggedOut: true };
  }
}
