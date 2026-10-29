import type { SqlClient } from '../database/database.service.js';
import { tokenHash } from './auth.service.js';

// Caller must wrap in a transaction. Also used by the CLI and integration tests.
export async function saveAdminPassword(client: SqlClient, email: string, hash: string) {
  // Serialize provisioning/reset for the same local login, including first creation.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`admin-password:${email}`]);
  let user = (
    await client.query<{ user_id: string }>(
      'SELECT user_id FROM admin_credentials WHERE email=$1 FOR UPDATE',
      [email],
    )
  ).rows[0];
  if (!user) {
    const candidates = (
      await client.query<{ id: string }>(
        "SELECT id FROM users WHERE lower(email)=$1 AND role='admin' AND active FOR UPDATE",
        [email],
      )
    ).rows;
    if (candidates.length > 1)
      throw new Error('Multiple admins share this email; resolve the duplicate first');
    const id =
      candidates[0]?.id ??
      (
        await client.query<{ id: string }>(
          "INSERT INTO users(email,username,role) VALUES($1,$2,'admin') RETURNING id",
          [email, email.split('@')[0]],
        )
      ).rows[0]!.id;
    user = { user_id: id };
    await client.query(
      'INSERT INTO admin_credentials(user_id,email,password_hash) VALUES($1,$2,$3)',
      [id, email, hash],
    );
  } else {
    const active = (
      await client.query(
        "SELECT id FROM users WHERE id=$1 AND role='admin' AND active FOR UPDATE",
        [user.user_id],
      )
    ).rows[0];
    if (!active)
      throw new Error('Account disabled or no longer an admin; password reset cannot re-enable it');
    await client.query(
      'UPDATE admin_credentials SET password_hash=$2,updated_at=now() WHERE user_id=$1',
      [user.user_id, hash],
    );
  }
  await client.query(
    'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
    [user.user_id],
  );
  await client.query('DELETE FROM auth_login_limits WHERE key_hash=$1', [
    tokenHash(`email:${email}`),
  ]);
  await client.query(
    "INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES($1::text,'admin.password_reset',$1::uuid,'{}')",
    [user.user_id],
  );
}
