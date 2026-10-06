#!/usr/bin/env bash
# db/cutover.sh — step 3: the real move, Render → the VPS Postgres.
#
# 1. stops every service that writes to the database (dashboard, household,
#    daily), so nothing changes on Render during the copy
# 2. copies Render → local (as rehearse.sh)
# 3. compares EVERY table's exact row count; any difference = abort, nothing
#    is switched and the services start again on Render
# 4. points DATABASE_URL in .env.local at the local Postgres (the old file is
#    kept as .env.local.bak-premove-<stamp>) and recreates the services
# 5. checks the app answers and reads the budget / household tables
#
# Render is NOT changed or deleted. Rollback: sudo bash db/rollback.sh
# Downtime = the rehearsal's total time plus a minute or two.
#   sudo bash /opt/dashboard/db/cutover.sh
. "$(dirname "$0")/lib.sh"
need_root
[ -s "$DB_HOME/render.url" ] || die "run db/setup.sh first"
docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER" || die "$PG_CONTAINER is not running (db/setup.sh)"
grep -qE '^DATABASE_URL=.*render\.com' "$APP_DIR/.env.local" || die ".env.local DATABASE_URL is not Render — already cut over?"
cd "$APP_DIR"

say "Who else is connected to Render right now (anything not on this VPS must be stopped first)"
psql_render -c "SELECT client_addr, application_name, state, count(*) FROM pg_stat_activity
                 WHERE datname = current_database() AND pid <> pg_backend_pid()
                 GROUP BY 1, 2, 3 ORDER BY 4 DESC"
echo "This VPS is $(curl -s -4 --max-time 5 ifconfig.me || echo '?')."
echo
read -r -p "Stop the app and move the database now? Type MOVE: " ok
[ "$ok" = MOVE ] || die "cancelled — nothing changed"

restart_on_render() {
  echo "Starting the services again on Render…"
  docker compose up -d "${APP_SERVICES[@]}"
}

say "Stop the writers: ${APP_SERVICES[*]}"
docker compose stop "${APP_SERVICES[@]}"
sleep 5
echo "Render connections from anything still running:"
psql_render -At -c "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'"

start=$(date +%s)
if ! copy_render_to_local; then restart_on_render; die "copy failed — still on Render"; fi
if ! compare_counts; then
  restart_on_render
  die "row counts differ (see above / $DB_HOME/count.diff) — still on Render, nothing switched"
fi

say "Point .env.local at the local Postgres"
stamp=$(date +%Y%m%d-%H%M%S)
cp -p .env.local ".env.local.bak-premove-$stamp"
echo "$stamp" > "$DB_HOME/premove.stamp"
new=$(local_url)
python3 - "$new" <<'PY'
import sys, re
new = sys.argv[1]
p = '/opt/dashboard/.env.local'
s = open(p).read()
s2, n = re.subn(r'(?m)^DATABASE_URL=.*$', 'DATABASE_URL=' + new, s)
if n == 0:
    sys.exit('no DATABASE_URL line')
open(p, 'w').write(s2)
print(f'replaced {n} line(s)')
PY

say "Recreate the services (env_file is read when a container is created)"
docker compose up -d --force-recreate "${APP_SERVICES[@]}"

say "Check"
sleep 20
docker compose exec -T dashboard node -e "
const {Client}=require('pg');const u=process.env.DATABASE_URL;
const c=new Client({connectionString:u,ssl:{rejectUnauthorized:false}});
(async()=>{await c.connect();
 const h=new URL(u).hostname;console.log('dashboard DATABASE_URL host:',h);
 for (const t of ['budget_statement_tx','budget_register','hh_users','hh_recipes','users','subscriptions']) {
   try{const r=await c.query('select count(*)::int n from '+t);console.log(t.padEnd(22),r.rows[0].n)}catch(e){console.log(t.padEnd(22),'-',e.message)}
 }
 await c.end()})().catch(e=>{console.log('FAILED',e.message);process.exit(1)})"
for s in household-api daily-api; do
  docker exec "$s" printenv DATABASE_URL | sed -E 's#^[a-z]+://[^@]*@([^/:]+).*#'"$s"' → \1#'
done
docker compose ps "${APP_SERVICES[@]}"

echo
echo "MOVED in $(( $(date +%s) - start ))s. Open the charts, budget and recipes and check them."
echo "Render is untouched. If anything is wrong: sudo bash $APP_DIR/db/rollback.sh"
echo "Then set up nightly backups: sudo bash $APP_DIR/db/backup.sh --install"
