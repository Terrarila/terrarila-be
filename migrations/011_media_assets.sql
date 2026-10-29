CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  storage_provider text NOT NULL CHECK (storage_provider = 'local'),
  storage_key text NOT NULL UNIQUE,
  url text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK(size_bytes > 0),
  width integer NOT NULL CHECK(width > 0),
  height integer NOT NULL CHECK(height > 0),
  sha256 text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_created ON media_assets(created_at DESC, id DESC);
