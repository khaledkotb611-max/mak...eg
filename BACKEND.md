# MAK backend and hosted site

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py createadmin --email khaledkotb611@icloud.com
npm start
```

Open http://localhost:8000. The local backend uses Django and SQLite. Hosted builds use a Cloudflare Worker and persistent D1 storage through the `DB` binding in `.openai/hosting.json`.

Open `/admin` and sign in with the email and password created in the terminal. Run `python manage.py run_outbox` in a second terminal for background email delivery and automatic local backups. `.env.example` documents variables; Django reads the process environment, not `.env` files automatically. See [Django server deployment](deploy/README.md) for production setup. Preparing this deployment does not move the current Sites deployment to Django.

## Products and prices

The business database is the only runtime source of product data and prices. `data/catalog.json` is retained only as the original, one-time migration input, preserving all 107 products, prices, translations, sizes, specifications and finishes. It is never a fallback for a failed API or an empty catalog. Once `catalog_seed_v1` is recorded, edits to that file and redeployment cannot overwrite database changes or resurrect deleted products.

`mak_backend.models.Product` represents the `products` table in the separate `business` SQLite connection (`quotes.sqlite3`); authentication remains in `auth.sqlite3`. The model is unmanaged because the shared versioned SQL migration owns the table in both SQLite and D1. Django's model-state migration also initializes/imports the business database on `manage.py migrate`. The normal storage initializer applies the same migration once if an existing installation starts before that command. ORM tools use the business database router; the existing API/services keep their transactional SQL architecture.

Products retain stable IDs, Arabic/English names and descriptions, price in EGP with at most two decimal places, image path/HTTPS URL, category, localized size/specification/unit/finish, active state, creation/update times and optimistic version. Deletion removes a product from both public and administrative lists while retaining a private tombstone. This protects old order snapshots and prevents retry/redeploy from reusing a deleted ID. Deactivation is reversible from the product editor.

The home catalog, listing and detail pages fetch `/api/products` initially and poll every 30 seconds while visible. Conditional ETags are calculated from database contents, so direct SQL inserts, edits, activation changes and deletes are detected, even if a timestamp is not manually changed. Hidden tabs stop polling and abort pending reads; returning to the tab or reconnecting refreshes it. Failures retain the last successful display with a warning, then retry with a 60/120-second maximum backoff. Empty catalogs remain valid. Administration refreshes the database product list alongside the existing 15-second order poll, preserves editor drafts, and rejects stale saves (409). The old `pricing.html` URL still redirects to the current catalog.

Authorized staff also manage products from the public home/list/detail pages. `catalog-frontend.js` checks the existing `/api/admin/session`, hides the management toolbar and card actions for everyone else, and lazily imports only the product dialog from protected `/admin.html`. `product-editor.js` shares the same form and POST/PATCH/DELETE implementation with the dashboard; it never creates a second catalog or sends prices for customer orders. Both surfaces use same-origin `/api/products` against the same Production `DB` D1 binding. Django uses the identical API/session flow against its own business SQLite database; that local database is not a second Production source and is not automatically mirrored to D1.

A successful public edit immediately re-fetches the public catalog; the other open surface observes it through the existing 15-second dashboard or 30-second public poll. A save during an outstanding public read queues one immediate follow-up read, so the older response cannot remain displayed until the next polling interval. Polling preserves unsaved form fields, blocks stale version saves, and offers explicit reload. Session expiry removes management actions and closes the editor. Django staff writes use the existing session CSRF token; no bearer credential is stored in public JavaScript.

The bidirectional UI integration tests execute both real scripts against the compiled Worker and one isolated SQLite-backed D1 adapter. They assert Add/Edit/Delete in both directions, deactivation/reactivation, preservation of all 107 seed records and historical purchase prices, ordinary visitor restrictions, session expiry, concurrent drafts, network recovery, duplicate prevention and Django's frontend CSRF contract. These tests do not write fixtures into the live customer database.

## Catalog API

- `GET /api/health`: service availability.
- `GET /api/products` and `GET /api/catalog`: the same authoritative catalog.
- `GET /api/products/<id>`: public active product; existing admin authorization can read inactive products.
- `GET /api/products?includeInactive=1`: all non-deleted products, admin only.
- `POST /api/products`: add a product, admin only; stable IDs make identical create retries safe.
- `PATCH /api/products/<id>`: edit price, availability, text, image or category. Requires the current `version`; nested translation edits preserve unspecified fields.
- `PUT /api/products/<id>`: replace editable product fields, requiring the current `version`.
- `DELETE /api/products/<id>`: delete a product with `{ "version": currentVersion }`; previous orders remain intact.

All writes retain the existing staff-session/CSRF or server-bearer authorization in Django, and the existing Sites admin allowlist/bearer rules in the Worker. No additional login system was introduced. Same-origin checks, validation, request limits, loading states and submission locks apply to catalog mutations.

Product-based orders send only `items: [{ "productId": "stable-id", "quantity": 1 }]` alongside the existing quote form. In the same transaction that creates the quote, the backend checks that every product is currently active and snapshots its database price/name/version in `quote_items`. Client price/total fields are rejected. Receipts include confirmed prices; the selected WhatsApp/email draft, admin details, copied order, email notification and Excel export include those snapshots. Identical request retries return the original prices even after a catalog price change. Old/general quote requests without product items remain supported. Existing quote IDs, status, notes, event history and notification behavior remain unchanged.

Private backups now snapshot database products (including inactive/deleted records) and order-price items, as well as the existing orders/followup/history/outbox. Restoring missing orders also fills missing price snapshots without repricing them or overwriting existing rows. Older backups without these optional tables remain readable; order restore does not replace the current product catalog.

### Django and hosted production

The current hosted site uses Worker/D1, not Django. The two backends share `0004_products.sql`, one-time source import, endpoint/JSON contracts and validation behavior, and are covered by equivalent CRUD/pricing/auth tests. Local SQLite and production D1 are independent databases. A frontend always uses its own origin's API and database; there is no automatic bidirectional database replication.

For an explicit transfer, `scripts/sync-catalog.mjs` reads the private live catalogs and reuses the existing POST/PUT/DELETE APIs. Tokens come only from `MAK_CATALOG_SOURCE_TOKEN` and `MAK_CATALOG_TARGET_TOKEN` in the shell environment (never browser code or CLI arguments). Configure existing `ADMIN_TOKEN` on the involved servers if needed. Preview is the default:

```sh
node scripts/sync-catalog.mjs --source https://SOURCE_ORIGIN --target http://localhost:8000
```

Add `--apply` to execute the reviewed direction. Extra destination products are preserved by default; `--prune` opts into mirroring deletions. The transfer includes inactive products and translations, uses destination versions to prevent stale updates, refuses redirects/credential-bearing URLs, and rereads the destination to verify completion. If interrupted or conflicted, rerun preview; it is not an unattended background sync. Recreating an already deleted ID is deliberately rejected. Choose the authoritative server and direction before enabling any recurring transfer. No transfer of production customer orders is performed.

## Quote requests

- `POST /api/quotes`: validate and save a request. Required: `name`, `projectType`, `message`, UUID `requestId`, and either `phone` or `email`. Send JSON. Optional email, if supplied, must be valid.
- `GET /api/quotes`: latest 100 requests, newest first; requires an active Django staff session or optional `Authorization: Bearer <ADMIN_TOKEN>`. Sites checks its existing authenticated administrator allowlist.

Example POST body:

```json
{
  "requestId": "a5e152b0-2f6c-42c2-a2b8-91f241c983c2",
  "name": "Test customer",
  "email": "",
  "phone": "01000000000",
  "projectType": "Home order",
  "message": "25 mm pipe, quantity 10"
}
```

A successful response contains `ok: true` and `quoteId`. Only show a saved confirmation after this response. Retrying identical content with the same `requestId` returns the same receipt, without inserting another row. Reusing that ID for different content returns 409. New submissions are limited to five per client address per 10-minute window; retries of saved requests remain available. The limit persists across restarts.

The customer chooses WhatsApp or email in the form. Submission saves the quote first, then opens only the selected message draft. WhatsApp reserves one tab during the click; a blocked popup leaves a single manual link for the selected channel. Email uses a `mailto:` draft in the customer's preferred mail application, without requiring Gmail. A failed save closes the reserved tab and leaves the selected contact link as a fallback. A prepared draft is not a confirmation that the customer sent it. Product order buttons lead to the form with current item details. Opening a WhatsApp or email draft alone does not create a stored request.

## Storage and privacy

Local requests are stored in `data/quotes.sqlite3` by default, with owner-only file permissions. Set `MAK_DATA_DIR` to a private persistent directory to keep data outside the site source. Existing `quotes.jsonl` requests are migrated once, preserving their IDs; the original file is retained locally. Back up the database and original data securely. Neither quotes nor database files are included in source or deployment archives.

The public server serves only named HTML/CSS/JS/image assets. Internal source, configuration, databases, legacy requests and backup files return 404. APIs do not permit cross-origin browser submissions or permissive CORS. SQL uses bound parameters, and request payloads are limited to 16 KiB.

For Django deployment, set `DJANGO_ENV=production`, a unique `DJANGO_SECRET_KEY`, explicit `DJANGO_ALLOWED_HOSTS`, `DJANGO_DEBUG=false`, and an HTTPS `SITE_ORIGIN`. Production settings reject unsafe defaults and enforce HTTPS, secure cookies and HSTS. `DJANGO_TRUST_PROXY=true` should be used only behind a proxy that overwrites incoming forwarded headers and prevents public access to Gunicorn. The default trusts the direct peer. The hosted Worker uses Cloudflare's client-address header. Optional `ADMIN_TOKEN` is a server-side API secret; never put it in frontend code or version control.

The SQLite/D1 schema is in `db/schema.ts`, with versioned migrations in `.openai/drizzle/`. Sites applies migrations before uploading the Worker; the Worker does not create tables at runtime. The test D1 adapter applies these same migration files to SQLite before executing application queries.

## Verification

```bash
python manage.py test tests
python manage.py check
npm run build
npm run test:worker
```

Worker tests use Node 24's SQLite implementation to execute the actual queries against a D1-compatible test adapter. They cover persistence, retries, authorization, validation, rate limits, private-file blocking and catalog consistency. They do not substitute for production D1 availability checks.

## Order dashboard

Open `/admin` for the order dashboard. On Sites, the dispatcher redirects visitors to ChatGPT sign-in, and the server allows only authenticated email addresses listed in server-side `ADMIN_EMAILS`. Both identity headers must be present; a signed-in account outside the allowlist receives 403. The public catalog remains available to customers. Every admin API checks authorization again. In Django, the shell and `/admin.html` redirect anonymous visitors to `/admin/login`. Login accepts only active staff accounts, with password hashing, durable database sessions, an eight-hour expiry and a persistent five-attempt/10-minute limit per client address. Duplicate account emails cannot authenticate. Cookie-based administrative mutations and logout require CSRF protection; logout accepts POST only. Forwarded identity headers do not grant Django access. Optional bearer access remains available to server tools.

The dashboard includes paginated search, counts, status filters (`new`, `contacted`, `fulfilled`), internal notes and per-order email submission state. Status and note updates use a version check to reject stale writes (409), so one session cannot overwrite another silently. Private data and API responses are never cached. The page is marked noindex.

The dashboard also shows private operational status: queued notifications, notifications requiring action/review, pending backups and Django worker heartbeat health. On Sites it explicitly identifies traffic-driven processing; it does not claim a continuously running Django worker. These metrics contain no customer contact details or runtime secrets.

Each successful followup update records an immutable event in the same transaction as the status/notes change. Events contain the authenticated administrator email (or `server-api` for bearer tooling), before/after status, whether notes changed, version and time. They do not duplicate private note contents. Failed/stale writes add no event, and failure to save the event rolls back the followup change. Existing orders acquire history only from this feature's activation; historical administrators are not invented.

The open dashboard refreshes every 15 seconds. New arrivals show a banner; optional browser notifications require explicit permission from the user. Closing the dashboard stops its browser polling but does not stop server-triggered email submissions.

### Email notification setup

Set these server-side environment values in Sites and deploy a saved version to apply them:

- `RESEND_API_KEY`: a Resend sending API key; mark it as a secret.
- `NOTIFICATION_FROM`: a sender on a verified Resend domain (for example `MAK <orders@example.com>`).
- `NOTIFICATION_TO`: the selected notification recipient.
- `SITE_ORIGIN`: the deployed site's origin for the protected dashboard link.
- `ADMIN_EMAILS`: comma-separated allowed administrator emails, normally the Site owner.

For Django, set the same email variables in its server environment. API keys never enter frontend code, source history or deployment archives. Resend account connection or an API key plus verified sender is required before email can actually send.

New orders and their notification records are committed atomically. Existing pre-dashboard orders remain intact and are not retroactively emailed. Hosted email work runs in `waitUntil` after the quote has been saved, so a mail provider failure does not turn a stored quote into a failed customer submission. Notification states distinguish queued work, missing setup, provider rejection, provider acceptance and requests requiring review. Provider acceptance does not confirm inbox delivery.

The outbox stores a stable payload and per-order idempotency key. On Sites, failed submissions retry on subsequent traffic or the retry button; there is no independent timer. In Django, the separate `run_outbox` process polls every five seconds, claims eligible notifications in batches, and retries failures with backoff, even without site traffic. The customer POST and administrative retry endpoint never call the mail provider. Restarting the worker preserves pending work. The retry button queues eligible failed/blocked notifications for its next cycle. Ambiguous attempts older than 23 hours require review in Resend rather than automatically risking duplication after the provider's 24-hour idempotency window. The outbox's lease prevents concurrent delivery workers from sending the same record simultaneously.

Additional API routes:

- `GET /api/admin/session`: verify current admin access.
- `GET /api/admin/health`: private notification counts, backup state and execution/heartbeat status.
- `GET /api/quotes/<uuid>/history?before=<version>`: newest 30 change events and optional `nextBefore` pagination cursor.
- `GET /api/quotes?limit=30&offset=0&status=new&q=...`: filtered requests, pagination, counts and email configuration readiness (no secrets).
- `PATCH /api/quotes/<uuid>` with `{ "status": "contacted", "notes": "Called customer", "version": 0 }`: persist status and notes.
- `POST /api/admin/notifications/retry`: queue failed/blocked notifications in Django, or retry up to five eligible notifications on Sites; requires email configuration.

Management tables are added in `.openai/drizzle/0001_order_management.sql`; the existing quotes table and request IDs are preserved. Tests execute the actual SQLite queries and stub the email provider, so no test customer messages are sent.

Order events are added by the append-only `0003_order_events.sql` migration. Django's local heartbeat table lives in `mak_backend/local_schema/` and is not a hosted D1 table. Django applies missing local schema files transactionally, records them in `app_migrations`, and uses a read-only migration check for normal reopened connections.

Temporary provider/network errors retry with backoff. `Retry-After` is respected for rate limits; the manual retry button cannot bypass waiting for 429 or concurrent 409 responses. Invalid configuration/permissions, invalid requests and exhausted quotas pause in `action_required` until explicit administrator retry after correction. Idempotency payload conflicts go to `needs_review`, which cannot be forced through the retry button. Provider response bodies and secrets are not exposed. A stale delivery worker cannot overwrite another worker's final result after losing its lease. Final notification state changes advance the backup revision atomically. Frozen payloads are kept on retry: correct the original sender's domain/permissions; changing global sender/recipient settings affects newly queued messages and does not rewrite ambiguous older attempts.

Resend API and idempotency references: https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/dashboard/emails/idempotency-keys.

## Private order backups

Hosted backups use the private R2 binding `BACKUPS`, separate from the live D1 database. New orders and successful status/note changes advance a durable backup revision in the same D1 transaction. Background work snapshots the quotes, notes, notification history and catalog, then marks that revision saved only after R2 accepts the complete object. Customer receipt success does not depend on R2 availability; failed backups leave the revision pending for a later request or the manual backup button. During continuous concurrent writes, at most five snapshots run in one background job; any remaining dirty revision retries on subsequent traffic. There is also a daily snapshot on subsequent traffic, rather than an independent timer or cron.

Retain the newest 30 complete versions. Snapshots contain no runtime secrets or admin keys. They use a SHA-256 checksum over the exact embedded JSON string, preserving Arabic and making corruption detectable. Access, listing and download require admin authorization; files are never public assets. Downloads and R2 listing remain available to an authorized admin even when D1 is unavailable.

The dashboard offers **save now**, **download**, and **restore missing orders**. Restore first previews missing/preserved counts, then requires explicit confirmation in the dashboard. Existing orders and their current notes/status are preserved. A restored order keeps the original request ID, preventing retry duplication. Historical notification records accepted by the provider retain that state; other restored orders become `needs_review` and are never automatically emailed again. A failed partial restore can be reviewed and repeated without overwriting existing rows. Catalog data is included for archival purposes; this restore action does not replace the current catalog.

Local Django stores private snapshots under `MAK_DATA_DIR/backups` (directory 0700, files 0600), using an atomic temporary-file replacement. The outbox worker saves pending backup revisions and daily snapshots even with no website traffic; customer saving and note updates do not wait for snapshot writes. Manual backup requests intentionally wait for their result. This local directory needs a separate disk/cloud copy if protection against local disk failure is required. Order snapshots do not include staff accounts or sessions in the private `auth.sqlite3` database. Backup files are excluded from source and deployment archives. Tests restore from a snapshot into missing test records and verify current notes and email state are preserved.

Protected APIs:

Snapshots now include `quote_events`; snapshots from earlier versions without that table remain readable. Restoration can fill missing historical events without replacing current records, notes or status, and can resume after an interrupted history batch. Events are matched to the original quote/request ID and bounded by the current quote version.

- `GET /api/admin/backups`: state and newest 30 versions.
- `POST /api/admin/backups`: create a snapshot now (202 if another job holds the lease).
- `GET /api/admin/backups/<id>`: download the checksummed snapshot.
- `POST /api/admin/backups/<id>/restore`: JSON `{ "mode": "preview" }`, then `{ "mode": "restore", "confirm": "<id>" }` to restore only absent orders.
- `POST /api/admin/notifications/test`: send a test only to the configured recipient, with UUID `requestId` and a stable provider idempotency key. Requires valid sender/recipient/key setup. A successful response means provider acceptance, not inbox delivery.

Resend sending must use a verified domain owned by the user; public Gmail/iCloud addresses can receive notifications but cannot be verified as sender domains. The current recipient is `khaledkotb611@icloud.com`. Sender verification and the secret API key must be configured before notifications can send.
