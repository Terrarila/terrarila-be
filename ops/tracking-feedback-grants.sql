-- Run as the database owner after migration 017, if petite_runtime is your app role.
GRANT SELECT,INSERT ON feedback,request_status_events TO petite_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON public_request_limits TO petite_runtime;
