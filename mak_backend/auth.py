"""Staff-only browser sessions; bearer access remains available to server tools."""
import hmac
import sqlite3
from contextlib import closing
from functools import wraps

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth.forms import AuthenticationForm
from django.contrib.auth.views import LoginView
from django.core.exceptions import ValidationError
from django.forms import EmailInput
from django.db import DatabaseError
from django.views.decorators.csrf import csrf_exempt, csrf_protect

from . import storage


class EmailBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        if not username or password is None:
            return None
        users = list(get_user_model().objects.filter(email__iexact=username.strip())[:2])
        # Duplicate emails cannot authenticate ambiguously. Missing users still hash a password.
        if len(users) != 1:
            get_user_model()().set_password(password)
            return None
        user = users[0]
        if user.check_password(password) and self.user_can_authenticate(user):
            return user


class StaffLoginForm(AuthenticationForm):
    error_messages = {"invalid_login": "الإيميل أو كلمة السر غير صحيحة، أو الحساب غير مصرح له بالدخول.",
                      "inactive": "الإيميل أو كلمة السر غير صحيحة، أو الحساب غير مصرح له بالدخول."}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"].label = "الإيميل"
        self.fields["username"].widget = EmailInput(attrs={"autocomplete": "username", "autofocus": True, "dir": "ltr"})
        self.fields["password"].label = "كلمة السر"

    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if not user.is_staff:
            raise ValidationError(self.error_messages["invalid_login"], code="invalid_login")


class StaffLoginView(LoginView):
    template_name = "mak_backend/login.html"
    authentication_form = StaffLoginForm

    def post(self, request, *args, **kwargs):
        from .views import _client_address
        try:
            with closing(storage.connect()) as db:
                limited = storage.rate_limited(db, "admin-login:" + _client_address(request))
        except (OSError, sqlite3.Error, ValueError):
            form = self.get_form_class()(request=request, data={})
            form.add_error(None, "الدخول غير متاح مؤقتًا. حاول مرة أخرى.")
            return self.render_to_response(self.get_context_data(form=form), status=503)
        if limited:
            form = self.get_form_class()(request=request, data={})  # Do not hash more passwords while throttled.
            form.add_error(None, "محاولات الدخول كثيرة. انتظر ١٠ دقائق وحاول مرة أخرى.")
            response = self.render_to_response(self.get_context_data(form=form), status=429)
            response["Retry-After"] = "600"
            return response
        return super().post(request, *args, **kwargs)


def bearer_authorized(request):
    return bool(settings.ADMIN_TOKEN) and hmac.compare_digest(
        request.headers.get("Authorization", "").encode(), f"Bearer {settings.ADMIN_TOKEN}".encode())


def staff_authorized(request):
    return request.user.is_authenticated and request.user.is_active and request.user.is_staff


def authorized(request):
    return bearer_authorized(request) or staff_authorized(request)


def admin_api(view):
    """Cookie mutations require CSRF; explicit bearer requests keep their API contract."""
    protected = csrf_protect(view)

    @wraps(view)
    def wrapper(request, *args, **kwargs):
        from .views import _json_response
        try:
            if bearer_authorized(request):
                return view(request, *args, **kwargs)
            if not staff_authorized(request):
                return _json_response({"error": "Admin authorization required"}, 401)
            return protected(request, *args, **kwargs)
        except (sqlite3.Error,DatabaseError,OSError):
            return _json_response({'error':'Storage unavailable. Retry later.'},503)

    return csrf_exempt(wrapper)
