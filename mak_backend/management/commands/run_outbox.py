"""A restartable, persistent outbox consumer for the Django deployment."""
import signal
import sqlite3
import threading
import math
import time
import uuid

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from mak_backend import backups, notifications, operations


class Command(BaseCommand):
    help = "Send queued order notifications and save private backups in a separate process."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Process one batch and exit (e.g. a scheduler).")
        parser.add_argument("--poll", type=float, default=settings.OUTBOX_POLL_SECONDS)
        parser.add_argument("--batch-size", type=int, default=settings.OUTBOX_BATCH_SIZE)

    def handle(self, *args, **options):
        if not math.isfinite(options['poll']) or not 1 <= options["poll"] <= 60 or not 1 <= options["batch_size"] <= 100:
            raise CommandError("Use --poll between 1 and 60 and --batch-size between 1 and 100.")
        stopped = threading.Event()
        worker_id = str(uuid.uuid4())
        started_at = int(time.time())
        stale_after = max(90, math.ceil(options['poll'] * 3))
        def pulse(error=''):
            operations.heartbeat(worker_id, started_at, stale_after, error=error)
        previous = {}
        if threading.current_thread() is threading.main_thread() and not options["once"]:
            for sig in (signal.SIGTERM, signal.SIGINT):
                previous[sig] = signal.signal(sig, lambda *_: stopped.set())
        try:
            self.stdout.write("Order outbox worker started.")
            if not notifications.configured():
                self.stdout.write("Email is not configured; orders stay saved and notifications wait.")
            while not stopped.is_set():
                failed = False
                try:
                    pulse()
                    count = notifications.process_pending(options["batch_size"], progress=pulse)
                    if count:
                        self.stdout.write(f"Processed {count} queued notification(s).")
                except (OSError, ValueError, sqlite3.Error):
                    failed = True
                    self.stderr.write("Outbox storage unavailable; retrying next cycle.")
                try:
                    backups.ensure_backup()
                except (OSError, ValueError, sqlite3.Error):
                    failed = True
                    self.stderr.write("Backup unavailable; retrying next cycle.")
                try:
                    pulse('background_work_failed' if failed else '')
                except (OSError, ValueError, sqlite3.Error):
                    failed = True
                if options["once"]:
                    if failed:
                        raise CommandError("Background work could not complete.")
                    break
                stopped.wait(options["poll"])
        finally:
            try:
                operations.heartbeat(worker_id, started_at, stale_after, state='stopped')
            except (OSError, ValueError, sqlite3.Error):
                pass
            for sig, handler in previous.items():
                signal.signal(sig, handler)
