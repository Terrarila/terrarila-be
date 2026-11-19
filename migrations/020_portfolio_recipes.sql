ALTER TABLE design_presets ADD COLUMN source_product_id uuid UNIQUE REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE design_presets ADD COLUMN source_portfolio_id uuid UNIQUE REFERENCES portfolio_entries(id) ON DELETE CASCADE;
ALTER TABLE design_presets ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE design_presets ADD CONSTRAINT preset_one_source CHECK (num_nonnulls(source_product_id,source_portfolio_id)<=1);
