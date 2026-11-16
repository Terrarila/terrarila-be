CREATE TABLE email_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('order', 'design_request')),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  design_request_id uuid REFERENCES design_requests(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CHECK ((kind='order' AND order_id IS NOT NULL AND design_request_id IS NULL)
      OR (kind='design_request' AND design_request_id IS NOT NULL AND order_id IS NULL)),
  UNIQUE (order_id),
  UNIQUE (design_request_id)
);
CREATE INDEX email_notifications_pending ON email_notifications(next_attempt_at,created_at)
  WHERE status='pending';
CREATE INDEX email_notifications_leases ON email_notifications(lease_until)
  WHERE status='sending';
