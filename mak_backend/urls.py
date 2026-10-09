from django.urls import path
from django.contrib.auth.views import LogoutView

from . import views, orders, backups, operations, catalog
from .auth import StaffLoginView


urlpatterns = [
    path("admin/login", StaffLoginView.as_view(), name="admin-login"),
    path("admin/logout", LogoutView.as_view(), name="admin-logout"),
    path("api/health", views.health),
    path("api/products", views.products),
    path("api/products/<slug:product_id>", catalog.detail),
    path("api/catalog", views.catalog),
    path("api/quotes", views.quotes),
    path("api/quotes/<uuid:quote_id>", orders.update),
    path("api/admin/session", orders.session),
    path("api/admin/health", operations.health),
    path("api/quotes/<uuid:quote_id>/history", orders.history),
    path("api/admin/notifications/retry", orders.retry_notifications),
    path('api/admin/notifications/test',orders.test_notification),
    path('api/admin/backups',backups.api),
    path('api/admin/backups/<str:backup_id>',backups.api),
    path('api/admin/backups/<str:backup_id>/restore',backups.api,{'restore':True}),
    path("admin", views.admin_page),
    path("admin/", views.admin_page),
    path("", views.homepage),
    path("products", views.products_page),
    path("products/", views.products_page),
    path("product/<path:slug>", views.product_page),
    path("<path:requested_path>", views.static_asset),
]
