-- Removing a synced item from Portfolio must not remove the sellable product.
ALTER TABLE products ADD COLUMN show_in_portfolio boolean NOT NULL DEFAULT true;
