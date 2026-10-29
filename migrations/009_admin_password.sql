-- Google accounts remain separate; local admins do not need a Google subject.
ALTER TABLE users ALTER COLUMN google_sub DROP NOT NULL;
CREATE TABLE admin_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_login_limits (
  key_hash text PRIMARY KEY,
  window_started timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1
);
