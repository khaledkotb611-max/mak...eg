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

Open http://localhost:8000. The local backend uses Django and SQLite. The repository contains a Cloudflare Worker implementation prepared to use persistent D1 through the `DB` binding. `.openai/hosting.json` records hosting metadata and binding names; it is not a Wrangler configuration and does not prove that Cloudflare resources or a live Worker deployment exist.

Open `/admin` and sign in with the email and password created in the terminal. Run `python manage.py run_outbox` in a second terminal for background email delivery and automatic local backups. `.env.example` documents variables; Django reads the process environment, not `.env` files automatically. See [Django server deployment](deploy/README.md) for production setup. Preparing this deployment does not move the current Sites deployment to Django.

## Products and prices

The business database is the only runtime source of product data and prices. `data/catalog.json` is the one-time migration input and the read-only GitHub Pages catalog source; it currently contains 214 products built from the original 107 entries, generated PPR price-list entries, and added PVC fittings from the price sheets. It is never a fallback for a failed API or an empty live catalog. Once `catalog_seed_v1` is recorded, edits to that file and redeployment cannot overwrite database changes or resurrect deleted products.

`data/poly-price-list.json` is the editable source for the PPR price list. Run `node scripts/apply-poly-price-list.mjs` to regenerate its entries in `data/catalog.json`; Arabic and English sizes are formatted separately. This updates the seed and GitHub Pages build only. To update a live Worker/D1 or Django database, use the protected catalog API with a preview-first file import:

```sh
node scripts/sync-catalog.mjs --catalog data/catalog.json --target https://YOUR_ORIGIN
```

Set `MAK_CATALOG_TARGET_TOKEN` in the shell when the target requires bearer access, review the add/update counts, then add `--apply` to send the changes. Extra target products are preserved unless `--prune` is explicitly passed. Existing availability is preserved when the seed file omits an `active` field; newly imported products start active. This changes products only; it does not transfer customer orders.

`mak_backend.models.Product` represents the `products` table in the separate `business` SQLite connection (`quotes.sqlite3`); authentication remains in `auth.sqlite3`. The model is unmanaged because the shared versioned SQL migration owns the table in both SQLite and D1. Django's model-state migration also initializes/imports the business database on `manage.py migrate`. The normal storage initializer applies the same migration once if an existing installation starts before that command. ORM tools use the business database router; the existing API/services keep their transactional SQL architecture.

Products retain stable IDs, Arabic/English names and descriptions, price in EGP with at most two decimal places, image path/HTTPS URL, category, localized size/specification/unit/finish, active state, creation/update times and optimistic version. Deletion removes a product from both public and administrative lists while retaining a private tombstone. This protects old order snapshots and prevents retry/redeploy from reusing a deleted ID. Deactivation is reversible from the product editor.

The home catalog, listing and detail pages fetch `/api/products` initially and poll every 30 seconds while visible. Conditional ETags are calculated from database contents, so direct SQL inserts, edits, activation changes and deletes are detected, even if a timestamp is not manually changed. Hidden tabs stop polling and abort pending reads; returning to the tab or reconnecting refreshes it. Failures retain the last successful display with a warning, then retry with a 60/120-second maximum backoff. Empty catalogs remain valid. Administration refreshes the database product list alongside the existing 15-second order poll, preserves editor drafts, and rejects stale saves (409). The old `pricing.html` URL still redirects to the current catalog.

### GitHub Pages build and release

The customer-facing Pages address verified for this repository is `https://khaledkotb611-max.github.io/mak...eg/`. GitHub Pages publishes a static artifact and does not run the Worker or Django backend. The build writes Pages files under `dist/pages`; the Pages workflow uploads exactly that directory with `actions/upload-pages-artifact@v3` and `actions/deploy-pages@v4`. The artifact contains the home page, `products.html`, `product.html?id=<product-id>`, `data/catalog.json`, `sitemap.xml`, `robots.txt`, required scripts/styles, and images. These routes are generated locally and covered by a production-like static preview test.

The Pages workflow runs on a push to `main` or a manual workflow dispatch. It uses Node 24, runs `npm ci`, lint and `npm test`, then deploys the uploaded artifact. Therefore, pushing to `main` will trigger a live Pages deployment when Actions and Pages are enabled. Confirm the Pages source is **GitHub Actions** before enabling this release path.

The Pages catalog and quote form call the Cloudflare Worker using the repository Actions **variable** `MAK_WORKER_ORIGIN`. Set it at **GitHub repository → Settings → Secrets and variables → Actions → Variables** to the real deployed Worker HTTPS origin, hostname only, with no path. The origin is public configuration, not a credential. `deploy-pages.yml` invokes `scripts/validate-pages-origin.mjs` and sets `MAK_REQUIRE_WORKER_ORIGIN=true`; missing, non-HTTPS, path-bearing, credential-bearing, and reserved example/test/invalid/localhost values fail the build. It also runs `scripts/check-worker-preflight.mjs`, a read-only `OPTIONS` request that requires the Worker to return the expected CORS response for this Pages origin. There is no fake/default origin in the Pages workflow. Ordinary local preview builds may omit the variable, but they then cannot send API requests to the Worker.

The repository does not identify the active Worker hostname. Copy the value from the actual Cloudflare deployment; do not substitute the GitHub Pages URL or invent a `workers.dev` URL. The Worker source currently allows CORS from `https://khaledkotb611-max.github.io`; verify this exact origin and `OPTIONS` behavior against the active Worker before release. A custom customer domain requires updating the Worker allowlist and tests to that exact origin. The preflight proves that the endpoint responds as the expected Worker CORS surface, but does not prove D1/R2 bindings, email delivery, or quotation persistence.

GitHub Pages project sites serve these files under `/mak...eg/`. The build includes `/mak...eg/robots.txt` and places the sitemap URL in it for artifact completeness, but Google only recognizes `robots.txt` at the host root (`https://khaledkotb611-max.github.io/robots.txt`). A file inside this repository's project subdirectory is not an effective host-level robots file. To publish an effective robots file, configure it at the account-level Pages root repository (`khaledkotb611-max.github.io`) or use a custom domain with a root-level file. See [Google's robots.txt guidance](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt).

Do not use the live `GET <MAK_WORKER_ORIGIN>/api/health` as a harmless read-only probe: in the current Worker it initializes/checks storage and starts pending notification/backup work through `waitUntil`. First verify against an isolated staging Worker and test database. The repository cannot verify Cloudflare account bindings, the actual Worker hostname, live CORS, or a real end-to-end quotation without account access and a safe staging deployment.

### Prepare and deploy the Cloudflare Worker

The Worker is built from `scripts/worker-template.js` into `dist/server/index.js`. It does not use Cloudflare's static-assets binding: the build embeds the site assets in the Worker bundle. Its database is the D1 binding `DB`, its private backup store is the R2 binding `BACKUPS`, and its ten ordered schema/data migrations are in `.openai/drizzle/0000_*.sql` through `0009_*.sql`. The Django SQLite databases are separate and are never copied to D1 by deployment.

`wrangler.jsonc` is the checked-in starting configuration. It proposes Worker name `mak-company-worker`, D1 name `mak-company-prod`, and R2 bucket `mak-company-backups`; these are proposed names, not evidence those resources exist. The D1 ID is deliberately all zeroes. This lets Wrangler validate/local-test the project but makes `npm run worker:deploy` stop until you replace it with the ID of the D1 database you created. No Cloudflare account ID is pinned, so Wrangler cannot silently select an account from this file. Do not point this configuration at a database containing real customer records until its existing contents and migrations have been reviewed and backed up.

#### 1. Confirm the Cloudflare account and create the resources

Install the locked Wrangler version with `npm ci`, then authenticate in your own terminal and check the account before creating anything:

```sh
npx wrangler login
npx wrangler whoami
```

The earlier read-only Cloudflare Dashboard inspection found no Worker projects in the selected account; it did not establish that this is the intended account for MAK. Confirm that yourself in the Dashboard and compare its account ID with `wrangler whoami` before continuing. The repository does not contain an existing D1 database ID, R2 bucket name, or deployed Worker URL.

Create a dedicated D1 database named `mak-company-prod` and a private R2 bucket named `mak-company-backups`. You can create them in **Cloudflare Dashboard → Storage & databases → D1 SQL Database → Create database** and **R2 Object Storage → Create bucket**, or in your terminal with:

```sh
npx wrangler d1 create mak-company-prod
npx wrangler r2 bucket create mak-company-backups
```

Copy the D1 `database_id` returned by Cloudflare into `d1_databases[0].database_id` in `wrangler.jsonc`. If you choose different names, update `database_name` and `bucket_name` to match. Keep the bucket private; it contains customer order backups. The Dashboard and Wrangler resource commands create Cloudflare resources, so run them only after confirming the account and names.

#### 2. Apply and verify D1 migrations

First exercise migrations against Wrangler's local D1 emulator (local state is ignored under `.wrangler/`):

```sh
npm run worker:check-config
npx wrangler d1 migrations apply mak-company-prod --local --config wrangler.jsonc
npx wrangler d1 migrations list mak-company-prod --local --config wrangler.jsonc
```

After reviewing the local result and confirming that the remote database is the newly created, empty MAK database, apply the same migrations remotely and inspect the applied list:

```sh
npx wrangler d1 migrations apply mak-company-prod --remote --config wrangler.jsonc
npx wrangler d1 migrations list mak-company-prod --remote --config wrangler.jsonc
```

Never apply these migrations to an existing business database as a trial. The Worker seeds catalog products from its bundle on first catalog/database access; D1 migrations create the schema but do not move Django data or customer orders. Cloudflare's D1 migration commands are documented [here](https://developers.cloudflare.com/d1/wrangler-commands/).

#### 3. Set production variables and secrets

After the Worker exists, set these in **Cloudflare Dashboard → Workers & Pages → mak-company-worker → Settings → Variables and Secrets** (or use `npx wrangler secret put SECRET_NAME` for secret values). Use production values that you control:

| Name | Type | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | Secret | Resend API credential; required only for email notifications. |
| `ADMIN_TOKEN` | Secret | High-entropy admin API bearer key. Never put it in `wrangler.jsonc`, GitHub Actions variables, frontend code, or a command-line argument. |
| `NOTIFICATION_FROM` | Variable | Sender address on a verified Resend sending domain. |
| `NOTIFICATION_TO` | Variable | Business email that receives quotation notices. |
| `SITE_ORIGIN` | Variable | Trusted admin/dashboard origin used in notification links. |
| `ADMIN_EMAILS` | Variable | Comma-separated allowlist, used only with a verified identity edge. |
| `TRUSTED_SITES_IDENTITY` | Variable | Keep `false`/unset for a direct Worker. Never enable it just to make login work. |

The quote intake and product catalog work without email credentials, but notifications will report as unconfigured. Do not put secrets in repository files or paste them into chat. Cloudflare documents Worker secrets [here](https://developers.cloudflare.com/workers/configuration/secrets/).

**Administrator access is a deployment blocker for a standalone Worker.** The current `/admin` asset route trusts `oai-authenticated-user-id` and `oai-authenticated-user-email` only when `TRUSTED_SITES_IDENTITY=true`; direct Worker requests do not establish those identity headers, and client-supplied headers must not be trusted. Keep that setting false unless a verified Sites edge replaces the headers and direct access to `workers.dev` is prevented. A separate authentication gateway that the Worker validates, or a code change to a standalone token-login route, is required before relying on the Worker-hosted dashboard. Do not treat setting `ADMIN_TOKEN` alone as proof that the current dashboard route is safely available.

#### 4. Validate and deploy only after review

The project has a local Worker preview and a guarded deploy command:

```sh
npm run worker:dev
# after account, resource, admin-access, and secret review:
npm run worker:deploy
```

`worker:deploy` checks the config, refuses the placeholder D1 ID, builds the Worker, and then invokes Wrangler deployment. It cannot verify from repository code alone that the bucket exists or that the selected account is correct; verify both in the Dashboard first. The config declares a five-minute native Cron Trigger for the existing `scheduled` handler, which processes notification outbox work and backup snapshots without waiting for normal page requests. Verify the trigger under **Workers & Pages → mak-company-worker → Settings → Triggers** after a future deploy. The repository's GitHub maintenance workflow also polls `/api/health` every five minutes as a fallback; once the native Cron is confirmed, remove/disable that GitHub schedule if you do not want redundant maintenance invocations. The D1 leases and notification idempotency protect concurrent runs.

The Worker CORS allowlist currently permits only `https://khaledkotb611-max.github.io` for product/catalog reads and quote submission. It answers `OPTIONS` only for those routes and the allowed `Content-Type` / `If-None-Match` headers. Keep it aligned with the deployed Pages origin; if you move Pages to a custom domain, change the Worker allowlist and its tests before publishing. After a successful deploy, copy the actual HTTPS Worker origin from Wrangler output or the Cloudflare Dashboard into **GitHub repository → Settings → Secrets and variables → Actions → Variables → `MAK_WORKER_ORIGIN`**. Do not guess or type a URL from the proposed Worker name. The Pages workflow then validates the origin and sends a read-only CORS preflight before it publishes Pages.

The Worker source, binding names, migrations directory, secret names, and local/remote commands follow [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [D1 migrations](https://developers.cloudflare.com/d1/wrangler-commands/), [R2 bucket commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/), and [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

The image build uses the platform-neutral Sharp library rather than macOS `sips`. CI and Pages install its locked dependency set using `npm ci`; generated feature images are resized and recompressed on the Ubuntu runner. Product catalog images remain at their supplied dimensions.

Authorized staff also manage products from the public home/list/detail pages. `catalog-frontend.js` checks the existing `/api/admin/session`, hides the management toolbar and card actions for everyone else, and lazily imports only the product dialog from protected `/admin.html`. `product-editor.js` shares the same form and POST/PATCH/DELETE implementation with the dashboard; it never creates a second catalog or sends prices for customer orders. Both surfaces use same-origin `/api/products` against the same Production `DB` D1 binding. Django uses the identical API/session flow against its own business SQLite database; that local database is not a second Production source and is not automatically mirrored to D1.

A successful public edit immediately re-fetches the public catalog; the other open surface observes it through the existing 15-second dashboard or 30-second public poll. A save during an outstanding public read queues one immediate follow-up read, so the older response cannot remain displayed until the next polling interval. Polling preserves unsaved form fields, blocks stale version saves, and offers explicit reload. Session expiry removes management actions and closes the editor. Django staff writes use the existing session CSRF token; no bearer credential is stored in public JavaScript.

The bidirectional UI integration tests execute both real scripts against the compiled Worker and one isolated SQLite-backed D1 adapter. They assert Add/Edit/Delete in both directions, deactivation/reactivation, preservation of all seed catalog records and historical purchase prices, ordinary visitor restrictions, session expiry, concurrent drafts, network recovery, duplicate prevention and Django's frontend CSRF contract. These tests do not write fixtures into the live customer database.

## Catalog API

- `GET /api/health`: service availability plus a scheduled-maintenance trigger; it can start pending email/backup work and is not read-only.
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

The production code paths are the Cloudflare Worker/D1 backend and the alternate Django/SQLite deployment; they share endpoint/JSON contracts and validation behavior but use independent databases. The repository does not establish that a Cloudflare Worker, D1 database, or R2 bucket is currently deployed. Verify the Cloudflare Dashboard and actual Worker origin before treating it as live. Local SQLite and D1 are independent databases, and there is no automatic bidirectional replication.

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
npm ci
npm run lint
python manage.py test tests
python manage.py check
npm run build
npm run test:worker
```

Worker tests use Node 24's SQLite implementation to execute the actual queries against a D1-compatible test adapter. They cover persistence, retries, authorization, validation, rate limits, private-file blocking and catalog consistency. They do not substitute for production D1 availability checks.

## Order dashboard

Open `/admin` for the order dashboard. On Sites, the dispatcher redirects visitors to ChatGPT sign-in. The hosted Worker accepts the forwarded identity only when `TRUSTED_SITES_IDENTITY=true` and the email is listed in server-side `ADMIN_EMAILS`; until then, the setting fails closed. Every admin API checks authorization again. In Django, the shell and `/admin.html` redirect anonymous visitors to `/admin/login`. Login accepts only active staff accounts, with password hashing, durable database sessions, an eight-hour expiry and a persistent five-attempt/10-minute limit per client address. Duplicate account emails cannot authenticate. Cookie-based administrative mutations and logout require CSRF protection; logout accepts POST only. Forwarded identity headers do not grant Django access. Optional bearer access remains available to server tools.

The dashboard includes paginated search, counts, status filters (`new`, `contacted`, `fulfilled`), internal notes and per-order email submission state. Status and note updates use a version check to reject stale writes (409), so one session cannot overwrite another silently. Private data and API responses are never cached. The page is marked noindex.

The Worker authorizes Sites administrators using the forwarded `oai-authenticated-user-id` and `oai-authenticated-user-email` headers against `ADMIN_EMAILS` only when `TRUSTED_SITES_IDENTITY=true`. This switch defaults to off, so forged headers fail closed. Enable it in the hosted Worker environment only after confirming that client-supplied copies are replaced by the Sites edge and that the Worker cannot be reached outside that edge. The repository cannot verify those live hosting properties. If either condition cannot be confirmed, leave the switch off: the Sites dashboard will remain unavailable until a verified identity layer is configured. `ADMIN_TOKEN` remains available for server tooling, not browser login. The alternate Django backend does not use these forwarded headers.

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
- `TRUSTED_SITES_IDENTITY`: set to `true` for the hosted Worker only after confirming the Sites edge replaces client-supplied identity headers and blocks direct access to the Worker. Leave unset/false until both checks are complete. This is a trust-boundary assertion, not a secret or a substitute for those checks.

For Django, set the same email variables in its server environment. API keys never enter frontend code, source history or deployment archives. Resend account connection or an API key plus verified sender is required before email can actually send.

New orders and their notification records are committed atomically. Existing pre-dashboard orders remain intact and are not retroactively emailed. Hosted email work runs in `waitUntil` after the quote has been saved, so a mail provider failure does not turn a stored quote into a failed customer submission. Notification states distinguish queued work, missing setup, provider rejection, provider acceptance and requests requiring review. Provider acceptance does not confirm inbox delivery.

The outbox stores a stable payload and per-order idempotency key. The Worker has a native scheduled handler, but `.openai/hosting.json` does not configure a Cron Trigger. The repository workflow `.github/workflows/worker-maintenance.yml` provides a fallback: every five minutes it requests `/api/health`, which explicitly starts the same notification and backup work through `waitUntil`; ordinary static asset requests do not start maintenance. To enable it, publish the current Worker version, set the GitHub Actions variable `MAK_WORKER_ORIGIN` to the deployed Worker origin (HTTPS scheme and hostname, without a path), and ensure the workflow is on the repository’s default branch with Actions enabled. Then use **Actions → Keep hosted Worker maintenance moving → Run workflow** to confirm the origin. Scheduled runs skip until the variable is set. GitHub scheduled runs are best-effort and can be delayed or dropped during high load; use a native hosting Cron Trigger if the host provides one and dependable timing is required. In Django, the separate `run_outbox` process polls every five seconds, claims eligible notifications in batches, and retries failures with backoff, even without site traffic. The customer POST and administrative retry endpoint never call the mail provider. Restarting the worker preserves pending work. The retry button queues eligible failed/blocked notifications for its next cycle. Ambiguous attempts older than 23 hours require review in Resend rather than automatically risking duplication after the provider’s 24-hour idempotency window. The outbox’s lease prevents concurrent delivery workers from sending the same record simultaneously.

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

Hosted backups use the private R2 binding `BACKUPS`, separate from the live D1 database. New orders and successful status/note changes advance a durable backup revision in the same D1 transaction. Background work snapshots the quotes, notes, notification history and catalog, then marks that revision saved only after R2 accepts the complete object. Customer receipt success does not depend on R2 availability; failed backups leave the revision pending for a later request or the manual backup button. During continuous concurrent writes, at most five snapshots run in one background job; any remaining dirty revision retries on a later request or scheduled run. The maintenance workflow also causes the daily-snapshot check to run while the site is idle, subject to GitHub Actions schedule delays.

Retain the newest 30 complete versions. Snapshots contain no runtime secrets or admin keys. They use a SHA-256 checksum over the exact embedded JSON string, preserving Arabic and making corruption detectable. Access, listing and download require admin authorization; files are never public assets. Downloads and R2 listing remain available to an authorized admin even when D1 is unavailable.

The dashboard offers **save now**, **download**, and **restore missing orders**. Restore first previews missing/preserved counts, then requires explicit confirmation in the dashboard. Existing orders and their current notes/status are preserved. A restored order keeps the original request ID, preventing retry duplication. Historical notification records accepted by the provider retain that state; other restored orders become `needs_review` and are never automatically emailed again. A failed partial restore can be reviewed and repeated without overwriting existing rows. Catalog data is included for archival purposes; this restore action does not replace the current catalog.

Local Django stores private business-data snapshots under `MAK_DATA_DIR/backups` (directory 0700, files 0600), using an atomic temporary-file replacement. The outbox worker saves pending backup revisions and daily snapshots even with no website traffic; customer saving and note updates do not wait for snapshot writes. Manual backup requests intentionally wait for their result. This local directory needs a separate disk/cloud copy if protection against local disk failure is required. Order snapshots do not include staff accounts or sessions in the separate `auth.sqlite3` database; keep a separately protected, encrypted backup of that file in the Django deployment's persistent-data backup plan. It contains password hashes and session data, so never place it in the public repository or the business-data restore endpoint. After an auth-database recovery, invalidate restored sessions and rotate Django signing/secret keys as appropriate. Backup files are excluded from source and deployment archives. Tests restore from a snapshot into missing test records and verify current notes and email state are preserved.

Protected APIs:

Snapshots now include `quote_events`; snapshots from earlier versions without that table remain readable. Restoration can fill missing historical events without replacing current records, notes or status, and can resume after an interrupted history batch. Events are matched to the original quote/request ID and bounded by the current quote version.

- `GET /api/admin/backups`: state and newest 30 versions.
- `POST /api/admin/backups`: create a snapshot now (202 if another job holds the lease).
- `GET /api/admin/backups/<id>`: download the checksummed snapshot.
- `POST /api/admin/backups/<id>/restore`: JSON `{ "mode": "preview" }`, then `{ "mode": "restore", "confirm": "<id>" }` to restore only absent orders.
- `POST /api/admin/notifications/test`: send a test only to the configured recipient, with UUID `requestId` and a stable provider idempotency key. Requires valid sender/recipient/key setup. A successful response means provider acceptance, not inbox delivery.

Resend sending must use a verified domain owned by the user; public Gmail/iCloud addresses can receive notifications but cannot be verified as sender domains. The current recipient is `khaledkotb611@icloud.com`. Sender verification and the secret API key must be configured before notifications can send.
