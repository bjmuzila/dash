#!/usr/bin/env bash
# db/backup.sh — nightly backup of the VPS Postgres (Render did this for us; now we do).
#
#   sudo bash /opt/dashboard/db/backup.sh            one backup now
#   sudo bash /opt/dashboard/db/backup.sh --install  nightly at 02:30 ET via /etc/cron.d
#   sudo bash /opt/dashboard/db/backup.sh --restore-test   restore the newest backup
#                                       into a scratch database and count tables
#
# A compressed custom-format dump to $DB_HOME/backups, the newest KEEP kept.
# OFF-BOX COPY: a backup on the same disk does not survive losing the server.
# If rclone is installed and $DB_HOME/rclone.remote holds a remote path
# (e.g. "b2:cbedge-backups/db" or a Hetzner Storage Box "hetzner:db"), each
# backup is copied there too, and copies older than 14 days are pruned there.
. "$(dirname "$0")/lib.sh"
need_root
KEEP=5

if [ "${1:-}" = --install ]; then
  cat > /etc/cron.d/cbedge-db-backup <<EOF2
# CB Edge Postgres nightly backup (db/backup.sh). 06:30 UTC = 02:30 ET (01:30 in winter)
SHELL=/bin/bash
30 6 * * * root bash $APP_DIR/db/backup.sh >> $DB_HOME/backups/backup.log 2>&1
EOF2
  echo "installed /etc/cron.d/cbedge-db-backup (log: $DB_HOME/backups/backup.log)"
  exit 0
fi

if [ "${1:-}" = --restore-test ]; then
  f=$(ls -1t "$DB_HOME"/backups/*.dump 2>/dev/null | head -1)
  [ -n "$f" ] || die "no backups yet"
  say "Restore test of $(basename "$f") into scratch database restore_test"
  docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d postgres -q \
    -c "DROP DATABASE IF EXISTS restore_test WITH (FORCE)" -c "CREATE DATABASE restore_test OWNER $DB_USER"
  docker cp "$f" "$PG_CONTAINER:/tmp/restore_test.dump"
  docker exec "$PG_CONTAINER" pg_restore -U "$DB_USER" -d restore_test -j "$JOBS" --no-owner /tmp/restore_test.dump || true
  docker exec "$PG_CONTAINER" psql -U "$DB_USER" -d restore_test -At \
    -c "SELECT count(*) || ' tables, ' || pg_size_pretty(pg_database_size('restore_test')) FROM pg_tables WHERE schemaname = 'public'"
  docker exec "$PG_CONTAINER" rm -f /tmp/restore_test.dump
  docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d postgres -q -c "DROP DATABASE restore_test WITH (FORCE)"
  echo "restore test OK"
  exit 0
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$DB_HOME/backups/$DB_NAME-$stamp.dump"
t0=$(date +%s)
echo "[$(date -u +%FT%TZ)] backup → $out"
# written through the /dump mount (no copy out of the container), then moved
docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -Z 6 -f "/dump/backup-$stamp.dump"
mv "$DB_HOME/dump/backup-$stamp.dump" "$out"
chown root:root "$out"
chmod 600 "$out"
echo "done in $(( $(date +%s) - t0 ))s, $(du -h "$out" | cut -f1)"

# keep the newest $KEEP here
ls -1t "$DB_HOME"/backups/*.dump | tail -n +$((KEEP + 1)) | xargs -r rm -f

if command -v rclone >/dev/null 2>&1 && [ -s "$DB_HOME/rclone.remote" ]; then
  remote=$(cat "$DB_HOME/rclone.remote")
  rclone copy "$out" "$remote" && echo "copied off-box → $remote"
  rclone delete --min-age 14d "$remote" || true
else
  echo "WARNING: no off-box copy (install rclone and put a remote path in $DB_HOME/rclone.remote)"
fi
