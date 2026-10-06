#!/usr/bin/env bash
# db/rehearse.sh — step 2: a full practice copy, Render → the VPS Postgres.
#
# The live site stays on Render the whole time. Nothing is switched. This
# times the copy (so the real cutover window is known) and checks that every
# table arrived. The tables the recorders are writing will differ by a few
# rows (they kept writing during the copy); every other table must match —
# budget, household, recipes, users, journal above all.
#
# Run it outside market hours: the dump reads the whole Render database.
#   sudo bash /opt/dashboard/db/rehearse.sh
. "$(dirname "$0")/lib.sh"
need_root
[ -s "$DB_HOME/render.url" ] || die "run db/setup.sh first"
docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER" || die "$PG_CONTAINER is not running (db/setup.sh)"

start=$(date +%s)
copy_render_to_local
compare_counts || true

echo
echo "REHEARSAL DONE in $(( $(date +%s) - start ))s. The app is still on Render."
echo "Expected differences: only tables the recorders write all day (flow_prints,"
echo "option_strike_gex_history, strike_growth, last_events, scanner_*, ...)."
echo "Any difference in a budget / household / user / journal table: STOP and send it over."
echo "Next, in a quiet window (weekend / after the close): sudo bash $APP_DIR/db/cutover.sh"
