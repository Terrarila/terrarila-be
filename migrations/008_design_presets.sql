CREATE TABLE design_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  image_url text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX design_presets_public_page ON design_presets(sort_order,id) WHERE published;
CREATE TABLE design_preset_materials (
  preset_id uuid NOT NULL REFERENCES design_presets(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  PRIMARY KEY(preset_id,material_id)
);
