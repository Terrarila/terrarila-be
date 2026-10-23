CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), google_sub text NOT NULL UNIQUE,
  email text NOT NULL, username text NOT NULL, avatar_url text,
  role text NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nonce_hash text NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
