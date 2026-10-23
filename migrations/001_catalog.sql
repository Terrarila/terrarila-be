CREATE TABLE material_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9-]{0,39}$'),
  name text NOT NULL, description text NOT NULL DEFAULT '',
  selection_mode text NOT NULL CHECK (selection_mode IN ('single','multiple')),
  min_selections integer NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections integer CHECK (max_selections >= min_selections),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  CHECK (selection_mode <> 'single' OR max_selections = 1)
);
CREATE TABLE materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES material_categories(id) ON DELETE RESTRICT,
  legacy_id text NOT NULL, slug text NOT NULL UNIQUE,
  name text NOT NULL, description text NOT NULL DEFAULT '', image_url text,
  price_vnd integer CHECK (price_vnd >= 0), unit text,
  availability text NOT NULL DEFAULT 'inquiry' CHECK (availability IN ('available','unavailable','inquiry')),
  published boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category_id, legacy_id),
  CHECK (price_vnd IS NULL OR (unit IS NOT NULL AND length(trim(unit)) > 0))
);
CREATE INDEX materials_public_page ON materials(sort_order,id) WHERE published;
CREATE INDEX materials_category_page ON materials(category_id,sort_order,id) WHERE published;
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
  name text NOT NULL, description text NOT NULL DEFAULT '',
  price_vnd integer CHECK (price_vnd >= 0),
  availability text NOT NULL DEFAULT 'inquiry' CHECK (availability IN ('available','unavailable','inquiry')),
  images jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(images) = 'array'),
  published boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_public_page ON products(sort_order,id) WHERE published;
CREATE TABLE portfolio_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
  name text NOT NULL, description text NOT NULL DEFAULT '',
  images jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(images) = 'array'),
  published boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portfolio_public_page ON portfolio_entries(sort_order,id) WHERE published;
CREATE TABLE site_content (
  key text PRIMARY KEY CHECK (key IN ('about','storefront')),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  published boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_subject text NOT NULL,
  action text NOT NULL, entity_id uuid NOT NULL, changes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_entity ON admin_audit_log(entity_id,created_at DESC);
