-- Pre-sales inquiries are deliberately separate from priced orders/payment ledger.
CREATE TABLE design_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  guest_hash text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  selection jsonb NOT NULL,
  contact jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','contacted','closed')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guest_hash,idempotency_key)
);
CREATE INDEX design_requests_admin_page ON design_requests(created_at DESC,id DESC);
