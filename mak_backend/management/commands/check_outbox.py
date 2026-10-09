from contextlib import closing

from django.core.management.base import BaseCommand, CommandError

from mak_backend import operations, storage


class Command(BaseCommand):
    help = 'Check whether a background worker has reported recently.'

    def handle(self, *args, **options):
        with closing(storage.connect()) as db:
            status = operations.worker_status(db)
        if status['state'] != 'running' or status['error']:
            raise CommandError('Background worker is unavailable or reporting an error.')
        self.stdout.write('Background worker is responding.')
