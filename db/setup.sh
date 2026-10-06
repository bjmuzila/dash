#!/usr/bin/env bash
# db/setup.sh — step 1 of moving Postgres onto this VPS. Safe to re-run.
#
# Creates /opt/cbedge-db (data, certs, password, dumps, backups), saves the
# current Render DATABASE_URL for the move and for rollback, and starts an
# EMPTY Postgres 18 next to the app. The app keeps using Render: .env.local is
# not touched here.
#
#   sudo bash /opt/dashboard/db/setup.sh
. "$(dirname "$0")/lib.sh"
need_root

say "Folders under $DB_HOME"
mkdir -p "$DB_HOME"/{pg,certs,dump,backups}
chmod 700 "$DB_HOME"

say "Render URL (read once from .env.local, kept for the move and for rollback)"
if [ ! -s "$DB_HOME/render.url" ]; then
  url=$(grep -E '^DATABASE_URL=' "$APP_DIR/.env.local" | tail -1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//')
  [ -n "$url" ] || die "no DATABASE_URL in $APP_DIR/.env.local"
  case "$url" in *render.com*) ;; *) die "DATABASE_URL does not point at Render — already moved? ($DB_HOME/render.url is missing)";; esac
  printf '%s' "$url" > "$DB_HOME/render.url"
  chmod 600 "$DB_HOME/render.url"
  echo "saved (host: $(echo "$url" | sed -E 's#^[a-z]+://[^@]*@([^/:]+).*#\1#'))"
else
  echo "already saved"
fi

say "Password"
if [ ! -s "$DB_HOME/db.env" ]; then
  pass=$(openssl rand -hex 24)
  cat > "$DB_HOME/db.env" <<EOF2
POSTGRES_USER=$DB_USER
POSTGRES_PASSWORD=$pass
POSTGRES_DB=$DB_NAME
EOF2
  chmod 600 "$DB_HOME/db.env"
  echo "generated"
else
  echo "already set"
fi

say "Self-signed TLS certificate (the app's pools ask for SSL on any non-localhost host)"
if [ ! -s "$DB_HOME/certs/server.crt" ]; then
  openssl req -new -x509 -days 3650 -nodes -subj "/CN=$PG_CONTAINER" \
    -keyout "$DB_HOME/certs/server.key" -out "$DB_HOME/certs/server.crt" >/dev/null 2>&1
fi
# the postgres user in the image is uid 999; the key must be 0600 and its own
chown 999:999 "$DB_HOME/certs/server.key" "$DB_HOME/certs/server.crt" "$DB_HOME/dump"
chmod 600 "$DB_HOME/certs/server.key"

say "App network ($APP_NETWORK)"
docker network inspect "$APP_NETWORK" >/dev/null 2>&1 || die "network $APP_NETWORK not found — is the main stack up? (cd $APP_DIR && docker compose up -d)"
echo ok

say "Start Postgres 18 (empty)"
docker pull -q "$PG_IMAGE" >/dev/null
db_compose up -d
wait_healthy
psql_local -At -c "SELECT 'running: ' || version()"
psql_local -At -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" >/dev/null
psql_local -At -c "SHOW ssl" | sed 's/^/ssl: /'

say "Disk"
df -h / | tail -1

say "Reachable from the app container?"
docker compose -f "$APP_DIR/docker-compose.yml" --project-directory "$APP_DIR" exec -T dashboard \
  node -e "const {Client}=require('pg');const c=new Client({connectionString:process.argv[1],ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query('select 1')).then(()=>{console.log('yes');return c.end()}).catch(e=>{console.log('NO:',e.message);process.exit(1)})" \
  "$(local_url)"

echo
echo "Setup done. The app is still on Render. Next: sudo bash $APP_DIR/db/rehearse.sh"
