ALTER TABLE site_content ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
CREATE INDEX admin_audit_page ON admin_audit_log(created_at DESC,id DESC);
CREATE INDEX admin_audit_actor ON admin_audit_log(actor_subject,created_at DESC,id DESC);
CREATE INDEX admin_audit_action ON admin_audit_log(action,created_at DESC,id DESC);

-- Runtime roles can append/read; deleting history requires a separate privileged maintenance role.
CREATE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit history is append-only' USING ERRCODE='42501';
END;
$$;
CREATE TRIGGER admin_audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON admin_audit_log
FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();
