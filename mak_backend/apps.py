import os
from pathlib import Path

from django.apps import AppConfig
from django.db.backends.signals import connection_created


def private_database(sender, connection, **kwargs):
    if connection.vendor == "sqlite":
        name = str(connection.settings_dict["NAME"])
        if not name.startswith("file:") and name != ":memory:" and Path(name).exists():
            os.chmod(name, 0o600)


class MakBackendConfig(AppConfig):
    name = "mak_backend"

    def ready(self):
        connection_created.connect(private_database, dispatch_uid="mak-private-auth-database")
