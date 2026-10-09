import os
from pathlib import Path
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured


BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "local-development-key-change-before-deploy")
DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() == "true"
ALLOWED_HOSTS = [host.strip() for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1],testserver").split(",") if host.strip()]
ROOT_URLCONF = "mak_backend.urls"
WSGI_APPLICATION = "mak_backend.wsgi.application"
APPEND_SLASH = False
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes", "django.contrib.sessions", "mak_backend"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "APP_DIRS": True,
              "OPTIONS": {"context_processors": ["django.template.context_processors.request"]}}]
AUTHENTICATION_BACKENDS = ["mak_backend.auth.EmailBackend"]
LOGIN_URL = "/admin/login"
LOGIN_REDIRECT_URL = "/admin"
LOGOUT_REDIRECT_URL = "/admin/login"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
SESSION_COOKIE_AGE = 8 * 3600
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "mak-backend-rate-limit",
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

DATA_DIR = Path(os.environ.get("MAK_DATA_DIR", str(BASE_DIR / "data")))
CATALOG_PATH = BASE_DIR / "data/catalog.json"
QUOTES_PATH = DATA_DIR / "quotes.jsonl"
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
QUOTES_DB_PATH = DATA_DIR / "quotes.sqlite3"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": DATA_DIR / "auth.sqlite3",
                         "OPTIONS": {"timeout": 10}},
             "business": {"ENGINE":"django.db.backends.sqlite3","NAME":QUOTES_DB_PATH,"OPTIONS":{"timeout":10}}}
DATABASE_ROUTERS = ['mak_backend.router.BusinessRouter']
TRUST_PROXY = os.environ.get("DJANGO_TRUST_PROXY", "false").lower() == "true"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
NOTIFICATION_FROM = os.environ.get("NOTIFICATION_FROM", "")
NOTIFICATION_TO = os.environ.get("NOTIFICATION_TO", "")
SITE_ORIGIN = os.environ.get("SITE_ORIGIN", "http://localhost:8000")

ENVIRONMENT = os.environ.get("DJANGO_ENV", "development")
if ENVIRONMENT not in ("development", "production"):
    raise ImproperlyConfigured("DJANGO_ENV must be development or production.")
PRODUCTION = ENVIRONMENT == "production"
if PRODUCTION:
    if len(SECRET_KEY) < 50 or len(set(SECRET_KEY)) < 5 or SECRET_KEY.startswith(("replace", "django-insecure")):
        raise ImproperlyConfigured("Production requires a unique DJANGO_SECRET_KEY of at least 50 characters.")
    if DEBUG or not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
        raise ImproperlyConfigured("Production requires DEBUG=false and explicit DJANGO_ALLOWED_HOSTS.")
    origin = urlsplit(SITE_ORIGIN)
    if origin.scheme != "https" or not origin.hostname or origin.username or origin.password or origin.path not in ("", "/") or origin.query or origin.fragment:
        raise ImproperlyConfigured("Production requires an HTTPS SITE_ORIGIN without a path.")
    if not any(origin.hostname == host or (host.startswith(".") and (origin.hostname == host[1:] or origin.hostname.endswith(host))) for host in ALLOWED_HOSTS):
        raise ImproperlyConfigured("SITE_ORIGIN must belong to DJANGO_ALLOWED_HOSTS.")
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    # Subdomains and preload must be enabled only after their HTTPS setup is confirmed.
    SECURE_HSTS_INCLUDE_SUBDOMAINS = False
    SECURE_HSTS_PRELOAD = False
    CSRF_TRUSTED_ORIGINS = [SITE_ORIGIN.rstrip("/")]
if TRUST_PROXY:
    # The reverse proxy must replace this header, never pass through a client's value.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

OUTBOX_POLL_SECONDS = 5
OUTBOX_BATCH_SIZE = 10
