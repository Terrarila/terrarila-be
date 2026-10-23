CREATE TABLE pricing_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  labour_vnd integer CHECK(labour_vnd >= 0),
  deposit_bps integer CHECK(deposit_bps BETWEEN 0 AND 10000),
  quantity_mode text CHECK(quantity_mode IN ('per_selection','quantity')),
  shipping_mode text CHECK(shipping_mode IN ('separate','pickup')),
  delivery_area_codes text[] NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pricing_policy(singleton) VALUES(true);
CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  snapshot jsonb NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotes_owner ON quotes(user_id,created_at DESC);
CREATE INDEX quotes_expiry ON quotes(expires_at);
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  quote_id uuid NOT NULL UNIQUE REFERENCES quotes(id), number text NOT NULL UNIQUE,
  idempotency_key uuid NOT NULL, request_hash text NOT NULL,
  snapshot jsonb NOT NULL, contact jsonb NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK(status IN ('awaiting_payment','confirmed','building','ready','shipping','completed','cancelled')),
  paid_vnd bigint NOT NULL DEFAULT 0 CHECK(paid_vnd BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,idempotency_key)
);
CREATE INDEX orders_owner_page ON orders(user_id,created_at DESC,id DESC);
CREATE INDEX orders_status ON orders(status,created_at DESC);
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  number text NOT NULL UNIQUE, snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  amount_vnd bigint NOT NULL CHECK(amount_vnd BETWEEN 1 AND 9007199254740991),
  reference text NOT NULL UNIQUE, confirmed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_order ON payments(order_id,created_at);
