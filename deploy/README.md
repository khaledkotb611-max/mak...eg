# Django server deployment

This deployment runs the existing catalog and order dashboard on Django. The current Sites deployment still runs its Worker/D1/R2 backend and ChatGPT administrator sign-in. These are separate databases; moving live orders requires an explicit export/import and DNS cutover after the destination server is selected.

## Public catalog on GitHub Pages

After enabling Pages with **Settings → Pages → Build and deployment → GitHub Actions**, the `Deploy GitHub Pages` workflow publishes a read-only catalog at `https://<owner>.github.io/<repository>/` whenever `main` is updated, or when manually run from the Actions tab. It includes the products and EGP prices from `data/catalog.json`.

GitHub Pages does not run this project's API or database. Product administration and server-backed quote submission therefore require the Worker or Django deployment described here; the Pages site is for browsing the static catalog.

## Prepare the server

Use a Linux server with Docker Compose, Nginx, an owned domain pointing to it, and a valid TLS certificate. Copy `.env.production.example` to a private `.env.production`, then set:

- `DJANGO_SECRET_KEY`: generate a unique random value with `python -c 'import secrets; print(secrets.token_urlsafe(64))'`. Keep it private.
- `DJANGO_ALLOWED_HOSTS`: the actual domain, without scheme or path.
- `SITE_ORIGIN`: `https://` followed by that domain, without a path.
- `DJANGO_TRUST_PROXY=true`: only with the supplied proxy header replacement and the loopback-only published port.
- `RESEND_API_KEY`, `NOTIFICATION_FROM`: the private sending key and a sender on your verified Resend domain. Blank values leave notifications blocked while orders remain saved.
- `NOTIFICATION_TO=khaledkotb611@icloud.com`.

`MAK_DATA_DIR=/var/lib/mak` matches the private shared persistent Docker volume. Keep this path consistent for both services. Optional `ADMIN_TOKEN` enables server API tooling; browser administration does not require it. Set file permissions with `chmod 600 .env.production`.

## Start

```bash
docker compose up -d --build
docker compose exec web python manage.py createadmin --email khaledkotb611@icloud.com
docker compose exec web python manage.py check --deploy
docker compose logs --tail=100 web outbox
```

Enter the admin password privately in the terminal. Passwords must be at least 12 characters and pass Django's validation. No default account or password is shipped. Use `docker compose exec web python manage.py changepassword khaledkotb611@icloud.com` to change it later.

Replace the domain and certificate paths in `nginx.conf.example`, install that configuration on the host, validate with `nginx -t`, and reload Nginx. The certificate must exist first. Gunicorn is published only at `127.0.0.1:8000`; do not expose this port publicly. Visit `https://your-domain/admin`: Django redirects to the Arabic email/password login page. The dashboard's logout sends a CSRF-protected POST.

The web entrypoint applies Django's auth/session migrations before Gunicorn starts. The outbox waits for the web health check and uses the same persistent volume without running migrations concurrently. Both services restart automatically. Login/session data is in `auth.sqlite3`; quotes, notification leases and rate limits are in `quotes.sqlite3`. Files are private and are not served as site assets.

Production enforces HTTPS, secure session/CSRF cookies, explicit hosts and HSTS. `check --deploy` may report `security.W005` and `security.W021`: HSTS subdomains and preload intentionally remain off because other subdomains' HTTPS setup has not been confirmed. Do not suppress unrelated warnings or enable these flags before that setup is known.

## Background delivery and recovery

`run_outbox` polls saved work every five seconds. Saving a quote atomically saves its pending notification and backup revision, then returns immediately without calling Resend. The worker claims work with database leases, preserves a stable provider idempotency key/payload, and retries temporary failures with backoff. It also saves pending order backups and daily snapshots. Closing the dashboard does not stop it. Restored historical orders requiring review are never sent automatically.

```bash
docker compose logs --tail=100 outbox
docker compose restart outbox
docker compose exec outbox python manage.py run_outbox --once
```

`--once` processes one batch and one backup cycle, then exits; it is also available for a scheduler. To drain a large queue keep the continuous worker running. Do not run email delivery in a Gunicorn thread or in the customer request.

The continuous worker reports a private durable heartbeat before/after notification attempts and each cycle. The dashboard detects stale workers, queued work, paused messages and backup failures. `docker compose exec outbox python manage.py check_outbox` fails if no worker has checked in recently or the active worker reports a background error. Compose runs this check every 30 seconds; an unhealthy container is visible through `docker compose ps` (health failure alone does not restart a running container). Ordinary process exits still use the configured restart policy. A `--once` process marks itself stopped; it does not pretend to be a continuous worker.

Permanent provider rejection pauses the affected notification until its original sender/permissions are corrected and an administrator retries. Temporary errors keep backoff; provider rate-limit delays survive manual retries. Unknown/idempotency payload conflicts require review and cannot be automatically resent. Original provider idempotency keys and payloads are retained.

A provider's acceptance is not proof of inbox delivery. Use the dashboard's test email after configuring a verified sender. No real email is sent by the automated tests.

The Docker volume survives normal container recreation. Do not run `docker compose down -v` unless intentionally deleting all local orders, backups, accounts and sessions. Copy private order backup files to separate storage for disk-failure recovery. Accounts/sessions are outside the order snapshots: use SQLite's online backup API to save `auth.sqlite3` separately, or create a new staff account after disaster recovery. Schedule `python manage.py clearsessions` periodically to remove expired sessions.

## Checks before cutover

```bash
python manage.py test tests
npm run build
npm run test:worker
```

Validate the server's HTTPS, create and retrieve a test order, stop/restart the worker and check its queued notification, then test a private backup download and restore preview. Export the current live orders securely before switching the domain. Docker must be installed to build/test the container; a source-only check does not verify the Linux container or the real server's TLS configuration.
