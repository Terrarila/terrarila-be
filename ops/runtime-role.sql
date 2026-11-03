-- Apply with the migration/DB owner after all migrations. Set its password interactively with \password petite_runtime.
-- This is a deployment template, not executed automatically against development DBs.
CREATE ROLE petite_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA public TO petite_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO petite_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO petite_runtime;
REVOKE ALL ON schema_migrations FROM petite_runtime;
REVOKE ALL ON admin_audit_log FROM petite_runtime;
GRANT SELECT,INSERT ON admin_audit_log TO petite_runtime;
-- No CREATE/schema ownership/TRUNCATE grants. Keep migrations/CLI grants on separate operator credentials.
-- Reapply grants for new tables after future migrations; audit SELECT/INSERT must remain restricted.
