#!/usr/bin/env bash
# db/rollback.sh — undo the cutover: DATABASE_URL back to Render, services
# recreated. Render was never changed, so it has everything up to the moment
# of the cutover. Anything written to the VPS database AFTER the cutover is NOT
# copied back (it stays in the local database; ask before deleting it).
#   sudo bash /opt/dashboard/db/rollback.sh
. "$(dirname "$0")/lib.sh"
need_root
cd "$APP_DIR"
[ -s "$DB_HOME/render.url" ] || die "no saved Render URL ($DB_HOME/render.url)"
grep -qE '^DATABASE_URL=.*render\.com' .env.local && die ".env.local already points at Render"

read -r -p "Point the app back at Render? Type BACK: " ok
[ "$ok" = BACK ] || die "cancelled"

cp -p .env.local ".env.local.bak-rollback-$(date +%Y%m%d-%H%M%S)"
python3 - "$(render_url)" <<'PY'
import sys, re
p = '/opt/dashboard/.env.local'
s = open(p).read()
s2, n = re.subn(r'(?m)^DATABASE_URL=.*$', lambda m: 'DATABASE_URL=' + sys.argv[1], s)
if n == 0:
    sys.exit('no DATABASE_URL line')
open(p, 'w').write(s2)
print(f'replaced {n} line(s)')
PY
docker compose up -d --force-recreate "${APP_SERVICES[@]}"
echo "Back on Render. The local Postgres keeps running (and its data) until you remove it."
