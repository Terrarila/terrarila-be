ALTER TABLE media_assets DROP CONSTRAINT media_assets_storage_provider_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_storage_provider_check
  CHECK (storage_provider IN ('local','vercel-blob'));

-- An intent binds the private staging pathname to one admin. Browser URLs are never trusted.
CREATE TABLE media_upload_intents (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  original_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  staging_path text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((completed_at IS NULL) = (result IS NULL))
);
CREATE INDEX media_upload_intents_expiry ON media_upload_intents(expires_at);
CREATE INDEX media_upload_intents_actor ON media_upload_intents(actor_id,created_at);
