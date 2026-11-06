# Request tracking and website feedback

Apply migration `017_tracking_feedback.sql` with operator credentials before
deploying this backend. It assigns unique 8-character aliases to existing
requests, preserving their original numbers and UUID URLs. New requests use the
short alias as their number. The receipt API/admin list expose the alias; old
`TL-<UUID>` numbers remain accepted for tracking. For an existing `petite_runtime`
application role, apply `ops/tracking-feedback-grants.sql` as the database owner.
`/health/ready` checks that the new tables exist.

`POST /v1/design-requests/track` accepts `{ "code": "A1B2C3D4" }` and a guest
bearer. Only number, status, selected material snapshot, dates and status history
are returned. Contact data, notes, guest hashes and internal request UUIDs are
excluded. FE `/tra-cuu` calls its same-origin POST proxy; cookies are established
automatically and work on a new browser. Codes are not authentication for private
data. Do not add personal fields to this projection. Codes are randomized, case
insensitive, collision checked, with 20 lookups per IP/guest per 15 minutes.

Statuses remain `pending`, `contacted`, `closed`. Admin updates require If-Match;
the status event and audit entry commit with the status change. Old requests get
one event for their known current state; no historical transitions are invented.

`POST /v1/feedback` accepts email (max 254) and message (5–4000 characters), a guest
bearer and UUID Idempotency-Key. Validation rejects unknown fields. Email is
normalized; retries with unchanged content return the saved ID, while changed
content with the same key returns 409. Writes are limited to 5 per IP/guest/hour.
`GET /v1/admin/feedback` requires admin auth and uses bounded time-cursor
pagination. The admin `/feedback` page displays escaped text and email. There is
no public feedback list, mail delivery, or promise of an email response.

The FE `/gop-y` page retains input/key on a failed response and shows a confirmation
only after success. The receipt has an accessible clipboard button, tracking link
and feedback link. Header/footer navigation exposes both pages.

Limits are stored in PostgreSQL, not process memory; only hashes are stored.
Expired limit records are cleaned in bounded batches by the existing maintenance
cron and auth cleanup. Request logs exclude bodies, phone, email and codes.
The daily Hobby cron remains unchanged. No extra cloud env variables are required.

Deploy order: backup → migration 017 → runtime grants → BE → admin/FE. Verify a
synthetic request, old-code lookup, wrong-code lookup, clipboard fallback, status
update, and feedback visible only to admins. Tests use isolated databases; cloud
migration and Production writes are not performed as part of code verification.

Local verification (2026-11-06): BE 56 tests, FE 48 tests and admin 41 tests
passed. The 36 API tests and importer smoke check also passed on disposable
PostgreSQL 17 instances. All three production builds passed. Browser checks
used an isolated fixture: request submission, short-code copy, admin status
update, code-only tracking with two history events and no contact fields, and
feedback submission visible in admin. Mobile tracking had no horizontal overflow.
