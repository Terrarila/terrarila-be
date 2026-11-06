# Import old data into migrated Neon

Run locally, never in Vercel's build/start command. Both databases must have
matching migrations 001–017 and columns. The target must contain no business
data; only the unchanged migration-created pricing row may exist.

Create `.env.neon-import` in the BE repository (gitignored):

```dotenv
SOURCE_DATABASE_URL="postgresql://<local-user>:<password>@127.0.0.1:5432/<old-database>"
SOURCE_PG_SSL=disable
TARGET_DATABASE_URL="postgresql://<owner>:<password>@<direct-host>.neon.tech/<production-database>?sslmode=require"
```

Copy the actual source URL from local configuration. Get the target from Neon →
Connect → correct Production branch/database → pooling disabled. Use operator
credentials. Never put credentials in chat, shell arguments or Git. Target TLS
is always verified; remote sources also require verified TLS. The command reads
only `.env.neon-import`, not `.env`, and does not require app/Blob configuration.

From `terrarila-be`, with the old PostgreSQL running:

```sh
# Counts and checks only; no row writes.
npm run db:import-neon

# Back up local DB/media using its usual local .env.
npm run backup:local

# After reviewing the dry-run and confirming the target:
npm run db:import-neon -- --apply
```

Apply rechecks the target inside a serializable transaction with table locks,
copies parent/child records with original IDs, and verifies every row before
commit. SQL/verification failures before commit roll back all imported rows.
Raw PostgreSQL JSON preserves bigint and timestamp precision. Source reads use a
read-only consistent snapshot. Pause source editing during the final import.

Catalog, content, pricing, presets, users/password hashes, commerce, media metadata
and audit history are copied. One `operations.imported` audit entry is appended.
Sessions, challenges, login limits and unfinished private uploads are excluded;
users must log in again. Target migration history stays intact. Existing target
business data and changed pricing defaults cause a refusal, not an upsert/delete.
Re-running an imported target is refused. After a lost commit acknowledgement,
inspect target rows instead of deleting data or blindly retrying.

Limits are 100000 rows and 64 MiB. This command copies database rows, not image
bytes. Upload assets separately with `npm run media:sync-blob -- --apply`.
After verifying the target's referenced files, `--mark-provider` can update media
metadata using the target operator env. Existing `/assets/...` URLs are retained.
Apply runtime role grants if necessary, then check `/health/ready`, `/v1/products`,
admin login and storefront images. No redeploy is needed solely for row changes
in the same database. For a target already used by customers/admin, use a reviewed
merge plan instead.

Verification: `npm test` includes fixture tests for dry-run, data preservation,
schema drift and rollback. `npm run db:import-neon:verify` starts a temporary
PostgreSQL 17 Docker container, imports synthetic catalog/orders, verifies rows,
and removes the container. Neither test uses Neon or the shop's local database.
