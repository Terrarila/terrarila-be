-- Private accounting data: never project these columns into public catalog responses.
ALTER TABLE materials
  ADD COLUMN purchase_price_vnd integer CHECK (purchase_price_vnd >= 0),
  ADD COLUMN purchase_unit varchar(80),
  ADD CONSTRAINT materials_purchase_unit_required CHECK (
    purchase_price_vnd IS NULL OR
    (purchase_unit IS NOT NULL AND length(trim(purchase_unit)) > 0)
  );
