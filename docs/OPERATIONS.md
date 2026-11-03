# Admin security, backup and operation

Local/VPS mode uses persistent filesystem storage. Vercel mode now uses public/private Blob stores and direct upload intents; see VERCEL-PREVIEW.md. The encrypted backup commands below cover local DB/media only, not Blob store backups. Configure provider backups, monitoring and production domains separately.

## Local encrypted backup

Run in `terrarila-be` with PostgreSQL running and `.env` configured:

```sh
npm run backup:local
```

The wrapper generates a 3072-bit RSA key pair once under `backups/keys/` (0600 files, 0700 directory), and creates AES-256-GCM encrypted database/media bundles under `backups/bundles/`. The AES key is wrapped with RSA-OAEP-SHA256. Existing keys are never overwritten. `pg_dump` must be installed, or the local Docker Compose `postgres` service must be running; the wrapper selects that container automatically. Generic `npm run backup` accepts `BACKUP_PUBLIC_KEY`, `BACKUP_DIR` and optional `PG_CONTAINER` explicitly.

Backups, keys and test artifacts are excluded from Git and Docker context. Never place backups in `MEDIA_ROOT`, upload them to public assets, or commit keys. Copy `backup.private.pem` to a protected offline location before relying on backup. Losing it makes bundles unreadable. Keys are kept locally for this development setup; encryption does not protect against an attacker who can read both the keys and backups on this machine.

Default retention is 30 days, changed by `BACKUP_RETENTION_DAYS`. Only completed `.ptbackup` bundles are expired, and the newest is retained. Failures preserve earlier completed bundles. The local wrapper prevents concurrent runs with a lock directory; after a crash, verify no backup is running before removing `backups/.backup-running`.

The database is dumped before copying immutable media. This includes every committed upload in the DB snapshot, with possible extra unreferenced files. Do not replace/delete media files during a backup; if adding media deletion later, coordinate it with backup snapshots. Migration files and source are versioned separately; environment secrets and PostgreSQL cluster roles are not part of the bundle. Store deployment secrets separately; recreate the runtime role when restoring onto a new cluster.

**Local copies on the same disk protect against logical mistakes, not disk failure, theft or ransomware.** A daily schedule targets about 24 hours of recoverable data loss while this computer and Docker are running. It is not a guaranteed production RPO. Move copies to a separate disk/machine or object storage before accepting that risk for real orders.

### Daily schedule

On macOS, `node ops/install-local-backup.mjs` installs the project-specific user LaunchAgent at **02:30 local time**. It uses absolute Node/project paths and reads the existing `.env`. This computer must be available and Docker/PostgreSQL running. Review errors in `backups/daily-backup-error.log`, successful JSON events in `backups/daily-backup.log`, and backup age on Admin → Vận hành. The scheduler is a user LaunchAgent, not an always-on server service. Reinstall it if the project/Node installation moves.

Remove only this scheduler:

```sh
launchctl bootout gui/$(id -u)/com.petitetterre.localbackup
rm ~/Library/LaunchAgents/com.petitetterre.localbackup.plist
```

Linux examples are under `ops/petite-backup.service.example` and `.timer.example`; replace paths/users and configure permissions before enabling. Run `npm run auth:cleanup` daily using the operator credentials as part of server maintenance; no scheduler for production is enabled here.

### Restore, without overwriting live data

Create an **empty, separate database** and **empty media directory**. Set `RESTORE_DATABASE_URL`, `RESTORE_MEDIA_ROOT` and `BACKUP_PRIVATE_KEY` (a path), then:

```sh
npm run restore -- /absolute/path/to/backup.ptbackup
```

For Docker PostgreSQL use `PG_CONTAINER`. Destination must differ from `DATABASE_URL` and `MEDIA_ROOT`. Restore rejects non-empty destinations; it never drops a live database. The archive is authenticated before extraction, rejects links/traversal/special files, and verifies the DB checksum. `pg_restore` runs transactionally. All restored bearer sessions are revoked and pending login challenges removed; `operations.restored` is appended to audit history. Check catalog, customer contacts/orders, payment totals and media in the isolated restore before deciding on a live switch. A failure during final filesystem copy can leave a partially prepared destination; investigate it before retrying, rather than deleting live data.

Reproducible destructive-to-fixtures-only verification:

```sh
npm run backup:verify
```

This creates a throwaway PostgreSQL Docker server, fixture database, media and keys; checks counts, file bytes, session revocation, audit, and refusal to overwrite; then removes the fixture. It never uses `.env` or real shop data.

## Audit and content revisions

Admin → Lịch sử hoạt động (`/audit`) reads `GET /v1/admin/audit-logs`; only active admins can access it. Filters support exact action/actor/entity and dates; pagination is bounded/cursor-based. Entries include safe request context, business changes and previous values for catalog, content and pricing updates. Existing historical rows remain valid. Authentication successes/failures, logout, authorization/rate-limit rejection, CLI password reset and role grant are recorded. No passwords, bearer tokens or unknown login emails are logged.

Audit is append-only through a database trigger and production runtime grants (`ops/runtime-role.sql`). A database owner/superuser can bypass triggers; this is not tamper-proof external storage. No automatic audit-history deletion is enabled. Archive/export before any privileged retention cleanup; set a retention period appropriate for shop operations and customer data. Security-log insertion failures emit `security_audit_failed`; they do not authorize rejected requests.

About/storefront reads in admin use private, non-cached routes. Writes require `If-Match` from the loaded revision (0 only for a truly absent document). A stale save returns 409 and the UI offers an explicit reload; no forced overwrite. Apply migration 015 before running the new backend/admin together.

## Metrics and performance

Admin → Vận hành (`/operations`) polls the admin-only metrics endpoint every 30 seconds while visible. Metrics cover requests/errors/active work, latency buckets, CPU, memory, media filesystem capacity and local backup age (26-hour freshness indicator). Counters are per-process and reset on restart; aggregate across replicas in an external collector for production. The backup directory is mounted read-only into the development BE container.

`LOG_REQUESTS=true` emits structured safe HTTP metadata with requestId, route template, status and duration; query strings, authorization headers and request bodies are excluded. 5xx errors and audit failures have separate events. Configure the host's collector/log rotation and alert destinations before production; none is silently connected to an external service. Suggested alerts: backup age >26h, low disk space, repeated audit failures, rising 5xx rate, and sustained high p95 latency (choose thresholds from measured normal traffic).

```sh
npm run perf:smoke
# Optional: PERF_BASE_URL=http://127.0.0.1:4102 PERF_REQUESTS=200 PERF_CONCURRENCY=4 npm run perf:smoke
```

The bounded read-only probe reports p50/p95/p99, errors and elapsed time. Optional `PERF_ADMIN_TOKEN` selects authenticated admin materials; do not put a token in source, command arguments, logs or screenshots. Local fixture results validate the probe, not production capacity.

Client cancellation is combined with request timeouts. Only categories get a five-minute freshness cache; other operational data remains immediately stale, with a one-minute inactive cache. Logout/401 clears all private query caches. New uploads generate 160px WebP thumbnails; existing uploads fall back to the original image, without changing stored URLs or deleting assets.

## Deployment preparation

- `ops/nginx-admin.conf.example` supplies HTTPS redirect, TLS, CSP/security headers, same-origin API/media proxies, body/time limits and rate limits. Replace example domain, certificate and dist paths; run `nginx -t`. Serve the built admin, never its dev server, publicly.
- Keep BE/DB ports private. The backend deliberately ignores untrusted forwarded IP headers; enforce per-client login limits at the trusted edge (many users can share the backend socket-IP bucket).
- Use a non-owner runtime DB role from `ops/runtime-role.sql`, a separate migration/CLI credential, verified DB TLS and a strong generated password. Do not reuse development Compose credentials in production.
- Use a non-root service/container user with write access only to media and read-only application files. Match persistent-volume ownership to that user; do not change ownership blindly on an existing host.
- Keep Swagger disabled in production, configure exact CORS origins if any cross-origin client is used, and retain same-origin admin requests with credentials omitted.
- JSON compression is rejected (415); admin requests are small uncompressed JSON. Upload accepts only PNG/JPEG/WebP, checks real bytes, enforces limits, strips metadata and limits concurrent decoding.
- `npm audit` checks both runtime and dev dependencies. The minimatch override pins the patched 11.0.3 used by lint dependencies; remove it when upstream dependencies adopt the fixed range, after rerunning lint/tests.

Reference: [PostgreSQL dump/restore](https://www.postgresql.org/docs/17/backup-dump.html), [OWASP logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html), [Nginx request limiting](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).
