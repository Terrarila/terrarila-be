ALTER TABLE products ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE portfolio_entries ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
