-- Keep historical numbers and UUID links; expose a short, independently unique alias.
ALTER TABLE design_requests ADD COLUMN tracking_code text;
DO $$
DECLARE item record; candidate text;
BEGIN
  FOR item IN SELECT id FROM design_requests LOOP
    LOOP
      candidate := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
      EXIT WHEN NOT EXISTS(SELECT 1 FROM design_requests WHERE tracking_code=candidate);
    END LOOP;
    UPDATE design_requests SET tracking_code=candidate WHERE id=item.id;
  END LOOP;
END $$;
ALTER TABLE design_requests ALTER COLUMN tracking_code SET NOT NULL;
ALTER TABLE design_requests ALTER COLUMN tracking_code SET DEFAULT upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
ALTER TABLE design_requests ADD CONSTRAINT design_requests_tracking_code_key UNIQUE(tracking_code);
ALTER TABLE design_requests ADD CONSTRAINT design_requests_tracking_code_format CHECK(tracking_code ~ '^[A-F0-9]{8}$');

CREATE TABLE request_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES design_requests(id),
  status text NOT NULL CHECK(status IN ('pending','contacted','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_status_events_request ON request_status_events(request_id,created_at,id);
-- Only record the known current state for old requests, without inventing history.
INSERT INTO request_status_events(request_id,status,created_at)
SELECT id,status,CASE WHEN status='pending' THEN created_at ELSE updated_at END FROM design_requests;

CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_hash text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  email text NOT NULL CHECK(length(email)<=254),
  message text NOT NULL CHECK(length(message) BETWEEN 5 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guest_hash,idempotency_key)
);
CREATE INDEX feedback_page ON feedback(created_at DESC,id DESC);
CREATE TABLE public_request_limits (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL CHECK(attempts>0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX public_request_limits_expiry ON public_request_limits(expires_at);
