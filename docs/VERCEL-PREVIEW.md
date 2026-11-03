# Vercel Preview: FE + BE + admin

Source supports Vercel, but a successful local test is not a live Preview deployment. All resource IDs, domains and secrets below must come from the selected Vercel team. Use separate Preview resources; do not point a Preview write flow at the production database or Blob stores.

## 1. Resources to create in Vercel

Import the three independent GitHub repositories as three projects. Root Directory is the repository root (`.`), not a nested terrarila-* folder. Use Node 24.x. BE: NestJS native entry src/main.ts. FE: Next.js. Admin: Other, npm run build, dist output, plus api/backend.ts.

For a starter database, Vercel Marketplace → Neon has a Free plan. Create/connect a database or isolated branch for Preview. Choose a region near the BE function. Copy the pooled connection string into DATABASE_URL and the direct connection string into MIGRATION_DATABASE_URL. The direct credential is for an operator/CI migration step, not a public frontend variable. Keep certificate verification enabled (PG_SSL=verify-full).

Create two Blob stores in the same selected team:

- Public media: validated WebP + original website assets. Its token is BLOB_READ_WRITE_TOKEN, and its origin is ASSET_BASE_URL (https://<store-id>.public.blob.vercel-storage.com, no path).
- Private uploads: unvalidated originals. Its distinct token is BLOB_UPLOAD_READ_WRITE_TOKEN. Do not use the public store for this role.

Review the displayed plans/quotas before creating resources. A free Neon database does not make Vercel hosting or Blob usage automatically free. Private GitHub organization repositories and commercial hosting must use a suitable Vercel plan.

## 2. BE Preview variables

Required:

- NODE_ENV=production
- MEDIA_STORAGE=vercel-blob
- DATABASE_URL: pooled Preview database URL
- PG_SSL=verify-full
- DB_POOL_MAX=3 (adjust using the selected database connection budget)
- CORS_ORIGINS: exact HTTPS origins for the chosen Preview storefront/admin
- ASSET_BASE_URL: public Blob store origin
- BLOB_READ_WRITE_TOKEN: public store token
- BLOB_UPLOAD_READ_WRITE_TOKEN: private store token
- SWAGGER_ENABLED=false
- CRON_SECRET: a generated random secret for cleanup; required for Vercel production, also configure for Preview manual verification
- GOOGLE_CLIENT_ID if using customer/legacy FE Google login

Never prefix these tokens with PUBLIC_ or NEXT_PUBLIC_. Apply all migrations through 016 with operator credentials before accepting traffic. /health/ready checks the new intent table too. Create/reset a Preview-only admin with the existing interactive admin:password CLI; never commit or paste its password into a shell command.

The migration CLI uses its process environment or the operator's ignored env file. Commands: npm run db:migrate, then initial catalog seed only for an empty Preview database. Import existing catalog/pricing/data deliberately when needed; a Git clone does not contain the live database. Do not execute an integration suite against the live database.

## 3. Move existing assets

The source tree contains bundled assets and local uploads. Do not deploy storage/ inside the function bundle; .vercelignore excludes it. Run from the BE checkout with the public Blob token and origin in an ignored operator env file/environment:

- npm run media:sync-blob: inventory only; no network writes or database writes.
- npm run media:sync-blob -- --apply: copy missing assets under assets/<relative-path>; verify every remote file SHA-256; refuse conflicting existing content. Never delete the local originals.
- Add --mark-provider only after importing the target database and applying migration 016: changes local provider metadata only after every referenced local media asset has been verified. This uses the operator's database URL, so verify the target before running.

All /assets/... catalog URLs remain unchanged. The BE redirects /assets/... to the public Blob CDN. FE rewrites directly to that same CDN, and admin uses PUBLIC_ASSET_BASE_URL, so large images and the GLB do not stream through a Vercel Function.

## 4. FE Preview variables

- TERRALA_API_URL: BE Preview HTTPS origin
- TERRALA_ASSET_URL: public Blob store origin
- TERRALA_API_BYPASS_SECRET: optional server-only Deployment Protection bypass secret for a protected BE Preview
- TERRALA_SITE_ORIGIN: optional exact origin of this FE Preview; never set the production origin for a different Preview URL
- TERRALA_MESSENGER_URL / TERRALA_ZALO_URL: real HTTPS contact URLs, or leave unset for the existing fallback dialog
- TERRALA_GOOGLE_CLIENT_ID if retaining legacy FE admin login

Rebuild after setting asset rewrites. Do not publish BLOB_* tokens in the FE project.

## 5. Admin Preview variables

- PUBLIC_API_BASE_URL: empty, so browser requests remain same-origin
- API_PROXY_TARGET: BE Preview HTTPS origin; server-side only
- API_PROTECTION_BYPASS_SECRET: optional server-only secret for a protected BE Preview
- PUBLIC_ASSET_BASE_URL: public Blob store origin
- PUBLIC_GOOGLE_CLIENT_ID / PUBLIC_GOOGLE_API_KEY / PUBLIC_GOOGLE_PROJECT_NUMBER: existing browser Drive Picker configuration

api/backend.ts forwards JSON under /v1 only, preserves the admin bearer, adds Deployment Protection bypass only on the server, rejects arbitrary targets and large/binary request bodies, and never follows redirects. It is not a media relay. No application write is authorized merely by passing Deployment Protection: BE session/admin guards still apply.

Add the actual admin Preview origin in Google OAuth Authorized JavaScript origins and website restrictions on the Picker key (also retain https://docs.google.com/*). Add the selected Google account as a test user if OAuth is in Testing.

## 6. Upload behavior

GET /v1/admin/media/upload-config tells the client the storage mode. Local keeps multipart. Blob mode uses:

1. Authenticated POST /v1/admin/media/upload-intents: metadata only. Server issues a path-bound 15-minute client token, one MIME type, no overwrite, up to the declared size (maximum 10 MiB); at most 20 intents per admin per 15 minutes.
2. Browser put() uploads directly to the private store. Google Drive selection uses this same path after downloading the selected image to the browser. Admin/Google tokens are not sent to Blob.
3. Authenticated POST /v1/admin/media/upload-intents/:id/complete: no file/URL body. Backend reads only its DB-bound path, verifies size/MIME/signatures, decodes with pixel limits, strips metadata and publishes WebP + thumbnail. Metadata + audit + intent result share one transaction. Owner checks and a row lock make completed retries idempotent.
4. Private bytes are removed after DB commit. Errors leave the form's old image URL unchanged. Failed/abandoned staging is cleaned by the maintenance task, not exposed as public content.

GET /v1/maintenance/media requires CRON_SECRET. Production Vercel Cron runs hourly; Vercel does not run these cron schedules on ordinary Preview deployments. During Preview, invoke manually with protected secrets through an operator tool. Cleanup skips locked rows, removes abandoned private objects after an expiry grace period, removes uncommitted public orphans, and keeps completed retry results for one day. It never deletes a committed media asset.

## 7. Preview acceptance

- /health/live and /health/ready; catalog and /products/[slug], including images and GLB over the CDN.
- Preview admin login, local-file upload >4.5 MB, actual Google Drive selection, preview image, attach to product, save, read on FE.
- Forged/oversize images, unauthorized/other-admin completion, expired intent, repeated completion and canceled upload.
- Missing product vs API outage; JSON errors do not become a false 404.
- Verify logs contain no tokens/body/contact data and original private Blob URLs cannot be read anonymously.
- Observe connection counts with hosted PostgreSQL/TLS and inspect cleanup. Local memory metrics/backup age do not certify Neon/Blob backup health; configure provider backups and monitoring separately before production.

Official references: https://vercel.com/marketplace/neon ; https://vercel.com/docs/vercel-blob/client-upload ; https://vercel.com/kb/guide/connection-pooling-with-functions ; https://vercel.com/docs/cron-jobs
