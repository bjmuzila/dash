#!/usr/bin/env bash
# Shared settings for the db/ scripts (moving Postgres from Render onto this VPS).
# Sourced, never run. Nothing secret lives in the repo: passwords, the Render
# URL, certs, data and dumps all live under $DB_HOME, outside the git checkout.
set -euo pipefail

APP_DIR=/opt/dashboard                 # the main checkout (docker-compose.yml, .env.local)
DB_HOME=/opt/cbedge-db                 # everything the database owns on the box
DB_COMPOSE="$APP_DIR/db/docker-compose.db.yml"
DB_PROJECT=cbedge-db
PG_CONTAINER=cbedge-postgres
PG_IMAGE=postgres:18                   # Render runs 18.4: same major, no upgrade step
APP_NETWORK=dashboard_default          # the main stack's compose network (project "dashboard")
DB_NAME=cbedge
DB_USER=cbedge
# The services that read DATABASE_URL from .env.local (docker-compose.yml env_file)
APP_SERVICES=(dashboard household daily)
JOBS=4                                 # parallel dump / restore workers

die() { echo "ERROR: $*" >&2; exit 1; }
say() { echo; echo "== $*"; }

need_root() { [ "$(id -u)" = 0 ] || die "run as root"; }

# The Render URL, captured once by setup.sh (before .env.local is ever changed).
render_url() { cat "$DB_HOME/render.url"; }

# The new local URL (what .env.local gets at cutover).
local_url() {
  # shellcheck disable=SC1091
  . "$DB_HOME/db.env"
  echo "postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@$PG_CONTAINER:5432/$POSTGRES_DB"
}

# psql inside the Postgres container, as the superuser, on the local database.
psql_local() { docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" "$@"; }

# psql against Render, from a throwaway container on the host network.
psql_render() { docker run --rm -i --network host "$PG_IMAGE" psql -v ON_ERROR_STOP=1 "$(render_url)" "$@"; }

db_compose() { docker compose -p "$DB_PROJECT" -f "$DB_COMPOSE" "$@"; }

wait_healthy() {
  for _ in $(seq 1 60); do
    docker exec "$PG_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 && return 0
    sleep 2
  done
  die "Postgres did not become ready (docker logs $PG_CONTAINER)"
}

# Exact row count of every public table, "table<TAB>count", sorted. $1 = local|render
count_tables() {
  local side=$1 run
  if [ "$side" = local ]; then run=psql_local; else run=psql_render; fi
  $run -At -c "SELECT string_agg(format('SELECT %L, count(*) FROM public.%I', tablename, tablename), ' UNION ALL ') FROM pg_tables WHERE schemaname = 'public'" \
    | $run -At -F $'\t' | sort
}

# Copy Render → local: a parallel directory-format dump, a fresh local database,
# a parallel restore, then planner statistics. Prints how long each part took.
# The dump is kept in $DB_HOME/dump/<stamp> (deleted by the next run).
copy_render_to_local() {
  local stamp t0 t1 t2 t3 rc
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  find "$DB_HOME/dump" -mindepth 1 -maxdepth 1 -type d -mmin +5 -exec rm -rf {} + 2>/dev/null || true

  say "Dump Render (parallel $JOBS) → $DB_HOME/dump/$stamp"
  t0=$(date +%s)
  docker run --rm --network host --user 999:999 -v "$DB_HOME/dump:/dump" "$PG_IMAGE" \
    pg_dump "$(render_url)" -Fd -j "$JOBS" -Z 1 --no-owner --no-acl -f "/dump/$stamp"
  t1=$(date +%s)
  echo "dump: $((t1 - t0))s, $(du -sh "$DB_HOME/dump/$stamp" | cut -f1)"

  say "Fresh local database"
  docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres -q \
    -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)" -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"

  say "Restore (parallel $JOBS)"
  set +e
  docker exec -e PGOPTIONS='-c maintenance_work_mem=1GB' "$PG_CONTAINER" \
    pg_restore -U "$DB_USER" -d "$DB_NAME" -j "$JOBS" --no-owner --no-acl "/dump/$stamp" 2> "$DB_HOME/restore.log"
  rc=$?
  set -e
  t2=$(date +%s)
  echo "restore: $((t2 - t1))s (exit $rc; $(grep -c 'error' "$DB_HOME/restore.log" || true) error lines — see $DB_HOME/restore.log)"
  grep -i 'error' "$DB_HOME/restore.log" | head -20 || true

  say "Planner statistics"
  docker exec "$PG_CONTAINER" vacuumdb -U "$DB_USER" -d "$DB_NAME" -j "$JOBS" -Z -q
  t3=$(date +%s)
  echo "analyze: $((t3 - t2))s — total $((t3 - t0))s"
  psql_local -At -c "SELECT 'local size: ' || pg_size_pretty(pg_database_size(current_database()))"
}

# Row counts, Render vs local, every table. Prints the differences; returns 1
# when any table differs. $1 = "strict" to treat any difference as failure.
compare_counts() {
  local r l
  r=$(mktemp); l=$(mktemp)
  say "Counting rows on Render (every table — takes a few minutes on the big ones)"
  count_tables render > "$r"
  say "Counting rows locally"
  count_tables local > "$l"
  echo "tables: render $(wc -l < "$r"), local $(wc -l < "$l")"
  if diff <(cat "$r") <(cat "$l") > "$DB_HOME/count.diff"; then
    echo "ALL $(wc -l < "$r") TABLES MATCH"
    rm -f "$r" "$l"; return 0
  fi
  echo "DIFFERENCES (< render  > local):"
  cat "$DB_HOME/count.diff"
  rm -f "$r" "$l"; return 1
}
