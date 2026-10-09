#!/bin/sh
set -eu
umask 077
mkdir -p "${MAK_DATA_DIR:-/var/lib/mak}"
if [ "${MAK_SKIP_MIGRATIONS:-false}" != "true" ]; then
    python manage.py migrate --noinput
fi
exec "$@"
