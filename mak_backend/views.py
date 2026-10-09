import json
import re
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone

from django.conf import settings
from django.contrib.auth.views import redirect_to_login
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.static import serve

from . import storage


PUBLIC_FILES = {"index.html", "products.html", "product.html", "pricing.html", "style.css", "script.js", "admin.html", "admin.css", "admin.js", "catalog-admin.js", "product-editor.js", "catalog-frontend.js", "product-editor.css", "vendor/exceljs-4.4.0.min.js"}
PUBLIC_IMAGES = {f"images/{name}.jpg" for name in ("hero", "about", "ppr", "pvc", "value")} | {"images/pvc-access-elbow.jpeg", "images/pvc-elbow-90.jpeg", "images/pvc-elbow-45.jpeg", "images/pvc-vent.jpeg", "images/pvc-coupling.jpeg"}


def _json_response(payload, status=200):
    if status == 401:
        payload = {**payload, "authMode": "django", "loginUrl": settings.LOGIN_URL}
    response = JsonResponse(payload, status=status)
    response["Cache-Control"] = "no-store"
    response["X-Content-Type-Options"] = "nosniff"
    response["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if status == 429:
        response["Retry-After"] = "600"
    return response


def _load_catalog():
    from .catalog import read
    with closing(storage.connect()) as db:
        return read(db)


def _client_address(request):
    # Forwarded headers are trusted only when explicitly configured behind a proxy.
    if settings.TRUST_PROXY:
        return request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or request.META.get("REMOTE_ADDR", "unknown")
    return request.META.get("REMOTE_ADDR", "unknown")


def health(request):
    if request.method != "GET":
        return _json_response({"error": "Method not allowed"}, 405)
    try:
        with closing(storage.connect()) as db:
            db.execute("SELECT 1 FROM quotes LIMIT 1")
        return _json_response({"ok": True, "service": "mak-backend", "storage": "ready"})
    except (OSError, ValueError, sqlite3.Error):
        return _json_response({"error": "Storage unavailable"}, 503)


@csrf_exempt
def products(request):
    from .catalog import listing
    return listing(request)


def catalog(request):
    if request.method!='GET':return _json_response({'error':'Method not allowed'},405)
    return products(request)


def validate_quote(body):
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")
    fields = {}
    for key, limit in (("name", 120), ("email", 160), ("phone", 40), ("projectType", 80), ("message", 2000)):
        value = body.get(key, "")
        if not isinstance(value, str) or len(value.strip()) > limit:
            raise ValueError(f"Invalid {key}")
        fields[key] = value.strip()
    if any(not fields[key] for key in ("name", "projectType", "message")):
        raise ValueError("Name, order type and message are required")
    if fields["email"] and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", fields["email"]):
        raise ValueError("A valid email is required")
    if fields["phone"] and not re.fullmatch(r"[+\d\s().-]{7,40}", fields["phone"]):
        raise ValueError("A valid phone is required")
    if not fields["email"] and not fields["phone"]:
        raise ValueError("A phone number or email is required")
    request_id = body.get("requestId")
    if not isinstance(request_id, str) or not re.fullmatch(r"[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", request_id):
        raise ValueError("A valid requestId is required")
    fields["requestId"] = request_id.lower()
    from .catalog import validate_items
    fields['items']=validate_items(body)
    return fields


@csrf_exempt
def quotes(request):
    if request.method == "GET":
        from .orders import list_orders
        return list_orders(request)
    if request.method != "POST":
        return _json_response({"error": "Method not allowed"}, 405)
    origin = request.headers.get("Origin")
    if origin and origin != f"{request.scheme}://{request.get_host()}":
        return _json_response({"error": "Origin not allowed"}, 403)
    if request.content_type != "application/json":
        return _json_response({"error": "JSON content type required"}, 415)
    if len(request.body) > 16_384:
        return _json_response({"error": "Request body is too large"}, 413)
    try:
        fields = validate_quote(json.loads(request.body))
    except (ValueError, UnicodeDecodeError):
        return _json_response({"error": "Invalid quote request"}, 400)
    try:
        from .catalog import order_items
        with closing(storage.connect()) as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute("SELECT * FROM quotes WHERE request_id = ?", (fields["requestId"],)).fetchone()
            if existing:
                saved = storage.serialize(existing)
                if any(saved[key] != fields[key] for key in ("name", "email", "phone", "projectType", "message")):
                    return _json_response({"error": "Request ID already used"}, 409)
                items=order_items(db,existing['id'])
                if [{'productId':item['productId'],'quantity':item['quantity']} for item in items]!=fields['items']:
                    return _json_response({'error':'Request ID already used'},409)
                return _json_response({"ok": True, "quoteId": existing["id"]}) if not items else _json_response({'ok':True,'quoteId':existing['id'],'items':items,'currency':'EGP'})
            db.commit()
            if storage.rate_limited(db, _client_address(request)):
                return _json_response({"error": "Too many quote requests"}, 429)
            quote_id = str(uuid.uuid4())
            with db:
                db.execute('BEGIN IMMEDIATE')
                prices=[]
                for item in fields['items']:
                    product=db.execute("SELECT * FROM products WHERE id=? AND active=1 AND deleted_at=''",(item['productId'],)).fetchone()
                    if not product:return _json_response({'error':'Product unavailable','code':'product_unavailable'},409)
                    prices.append((item,product))
                db.execute("INSERT OR IGNORE INTO quotes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (
                    quote_id, fields["requestId"], fields["name"], fields["email"], fields["phone"],
                    fields["projectType"], fields["message"], datetime.now(timezone.utc).isoformat(),
                ))
                saved = db.execute("SELECT * FROM quotes WHERE request_id = ?", (fields["requestId"],)).fetchone()
                if saved['id']==quote_id:
                    for item,product in prices:
                        db.execute('INSERT INTO quote_items VALUES (?,?,?,?,?,?,?)',(quote_id,product['id'],item['quantity'],product['price'],product['name'],product['name_en'],product['version']))
                db.execute("INSERT OR IGNORE INTO quote_notifications (quote_id) VALUES (?)",(saved["id"],))
                db.execute('INSERT OR IGNORE INTO backup_state (id) VALUES (1)')
                db.execute('UPDATE backup_state SET revision=revision+1 WHERE id=1')
            if any(storage.serialize(saved)[key] != fields[key] for key in ("name", "email", "phone", "projectType", "message")):
                return _json_response({"error": "Request ID already used"}, 409)
            items=order_items(db,saved['id'])
            if [{'productId':item['productId'],'quantity':item['quantity']} for item in items]!=fields['items']:
                return _json_response({'error':'Request ID already used'},409)
            return _json_response({"ok": True, "quoteId": saved["id"],**({'items':items,'currency':'EGP'} if items else {})}, 201)
    except (OSError, ValueError, sqlite3.Error):
        return _json_response({"error": "Could not save request. Retry later."}, 503)


def _serve_site_file(request, relative_path):
    if request.method not in ("GET", "HEAD"):
        return _json_response({"error": "Method not allowed"}, 405)
    if relative_path not in PUBLIC_FILES | PUBLIC_IMAGES:
        return HttpResponse(status=404)
    if relative_path == "admin.html":
        from .auth import staff_authorized, bearer_authorized
        if not (staff_authorized(request) or bearer_authorized(request)):
            return redirect_to_login(request.get_full_path(), settings.LOGIN_URL)
    target = settings.BASE_DIR / relative_path
    if target.is_symlink() or not target.resolve().is_relative_to(settings.BASE_DIR.resolve()):
        return HttpResponse(status=404)
    response = serve(request, relative_path, document_root=str(settings.BASE_DIR))
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "no-store" if relative_path == "admin.html" else "no-cache"
    return response


def homepage(request):
    return _serve_site_file(request, "index.html")


def products_page(request):
    return _serve_site_file(request, "products.html")


def product_page(request, slug):
    try:
        if not any(item["id"] == slug for item in _load_catalog()["products"]):
            return HttpResponse(status=404)
    except (OSError,ValueError,sqlite3.Error):
        return _json_response({'error':'Catalog unavailable'},503)
    return _serve_site_file(request, "product.html")


def static_asset(request, requested_path):
    return _serve_site_file(request, requested_path)


def admin_page(request):
    return _serve_site_file(request, "admin.html")
