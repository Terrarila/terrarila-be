-- Confirmed business policy: material subtotal + 50% labour; deposit 50%, shipping separate.
-- Retain historical fixed-labour column for previous snapshots; new code uses labour_bps only.
ALTER TABLE pricing_policy ADD COLUMN labour_bps integer CHECK(labour_bps BETWEEN 0 AND 10000);
UPDATE pricing_policy SET labour_bps=5000,deposit_bps=5000,shipping_mode='separate',
  delivery_area_codes=ARRAY['HCM'],revision=revision+1,updated_at=now() WHERE singleton;
-- quantity_mode deliberately remains unconfigured until sale units are supplied by the shop.
