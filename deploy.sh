#!/usr/bin/env bash
# deploy.sh — runs ON the VPS. push.ps1 calls it after `git pull`; you can also
# run it by hand from /opt/dashboard.
#
#   bash deploy.sh                deploy everything since the last GOOD deploy
#   bash deploy.sh --seed <sha>   same; <sha> is only used when there is no record
#                                 of a last good deploy yet (push.ps1 passes it)
#   bash deploy.sh --from <sha>   force the starting point
#   bash deploy.sh --full         rebuild + restart every service, no planning
#   bash deploy.sh --no-cache     clean image rebuild (after dependency changes)
#   bash deploy.sh rollback       put the previous deploy's images back
#   bash deploy.sh status         what is live, what rollback would restore
#
# WHAT IT DOES THAT A PLAIN `docker compose build && up -d` DID NOT (2026-10-09)
#
#   1. Only what changed. The dashboard image is `COPY . .` of the whole repo, so
#      ANY commit — a budget page, an owner page, a doc — produced a new image and
#      restarted the trading server and the jobs container. Now the commit's file
#      list is matched to services: a change that only touches owner-vite/,
#      budget-vite/, recipe-vite/, daily-vite/, demo-owner/, voltick-*/,
#      deploy/vela|household|daily|journal/ rebuilds just that service. Anything
#      the planner cannot place — server-v2/, cbedge-v3/, app/, compose itself,
#      any unknown path — falls back to the old full deploy. Unknown means full.
#   2. Bind-mounted config (deploy/edge/*.conf, journal, affiliates, demo-sites)
#      used to need a manual restart after a change; those containers are now
#      recreated when their mounted files change.
#   3. Rollback. Before building, every image about to be rebuilt is tagged
#      :prev. `bash deploy.sh rollback` (or `.\push.ps1 -Rollback`) puts those
#      back in seconds — no rebuild.
#   4. Health gate. After the restart it waits for each touched container to go
#      healthy and for the dashboard to answer /api/healthz/ready WITH THE NEW
#      VERSION. If the server does not come up, the previous images go back on
#      automatically (DEPLOY_AUTO_ROLLBACK=0 to turn that off). Feed problems
#      (TastyTrade/dxLink) only warn: a rollback cannot fix an upstream outage
#      and would just restart the server a second time.
#   5. One at a time (flock), a retry when Docker Hub flakes mid-build, and a
#      line per deploy in .deploy/history.log.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
STATE="$ROOT/.deploy"
mkdir -p "$STATE"
HISTORY="$STATE/history.log"

say()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!!\033[0m  %s\n' "$*"; }
die()  { printf '\033[31mXX\033[0m  %s\n' "$*"; exit 1; }

# ── one deploy at a time ──────────────────────────────────────────────────────
exec 9>"$STATE/lock"
if ! flock -n 9; then die "another deploy is already running (lock: $STATE/lock)"; fi

# ── args ──────────────────────────────────────────────────────────────────────
CMD=deploy; FROM=""; SEED=""; FULL=0; NOCACHE=""
while [ $# -gt 0 ]; do
  case "$1" in
    rollback|status) CMD="$1" ;;
    --from) FROM="${2:-}"; shift ;;
    --seed) SEED="${2:-}"; shift ;;
    --full) FULL=1 ;;
    --no-cache) NOCACHE="--no-cache"; FULL=1 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

command -v python3 >/dev/null || die "python3 is required on the VPS (apt-get install -y python3) — nothing was changed"

AUTO_ROLLBACK="${DEPLOY_AUTO_ROLLBACK:-1}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-300}"
DC="docker compose"

version_at() { git show "${1:-HEAD}:package.json" 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin).get("version",""))' 2>/dev/null || true; }
now_s() { date +%s; }
# Each line also goes to state/deploy-history.log: ./state is mounted at
# /app/state, so owner → Vela Health's Activity card can read the deploys
# (server-v2/activity.cjs). The first time, it is seeded with the history so far.
# A mirror that fails never fails the deploy.
MIRROR="$ROOT/state/deploy-history.log"
log_history() {
  local line; line="$(date -u +%FT%TZ)	$*"
  printf '%s\n' "$line" >> "$HISTORY"
  { mkdir -p "$ROOT/state" && { [ -f "$MIRROR" ] || cp "$HISTORY" "$MIRROR"; } && \
    { tail -n 1 "$MIRROR" 2>/dev/null | grep -qxF "$line" || printf '%s\n' "$line" >> "$MIRROR"; }; } 2>/dev/null || true
}
# The one-line note for a version: the first non-blank line of the BODY of the
# commit whose subject is that version (push.ps1 commits as "vM.D.N"). Empty
# when the push carried no note. Tabs are flattened so the log stays parseable.
version_note() {
  git log -1 --format=%b --grep="^${1}\$" 2>/dev/null | grep -m1 -v '^[[:space:]]*$' | tr '\t' ' ' | cut -c1-200 || true
}

# Images of services that BUILD (have a build: section), as "service image".
built_images() {
  $DC config --format json | python3 -c '
import json, sys
d = json.load(sys.stdin)
for name, s in sorted(d.get("services", {}).items()):
    if s.get("build") and s.get("image"):
        print(name, s["image"])
'
}

# ── health ────────────────────────────────────────────────────────────────────
# Waits for every listed service's container to be healthy (or just running, when
# it has no healthcheck). Returns non-zero naming the first one that is not.
wait_healthy() {
  local deadline=$(( $(now_s) + HEALTH_TIMEOUT )) svc cid st pending
  while :; do
    pending=""
    for svc in "$@"; do
      cid="$($DC ps -q "$svc" 2>/dev/null | head -1)"
      if [ -z "$cid" ]; then pending="$pending $svc(no-container)"; continue; fi
      st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo gone)"
      case "$st" in
        healthy|running) ;;
        *) pending="$pending $svc($st)" ;;
      esac
    done
    [ -z "$pending" ] && return 0
    if [ "$(now_s)" -ge "$deadline" ]; then warn "not healthy after ${HEALTH_TIMEOUT}s:$pending"; return 1; fi
    sleep 5
  done
}

# Asks the dashboard itself. Prints the JSON; the caller checks it.
ready_json() {
  $DC exec -T dashboard node -e "
    fetch('http://127.0.0.1:'+(process.env.PORT||'3001')+'/api/healthz/ready',{signal:AbortSignal.timeout(5000)})
      .then(r=>r.json()).then(b=>console.log(JSON.stringify({ok:b.ok,version:b.version,reasons:b.reasons||[]})))
      .catch(e=>console.log(JSON.stringify({ok:false,version:null,reasons:['unreachable']})))" 2>/dev/null || echo '{"ok":false,"version":null,"reasons":["exec-failed"]}'
}

# The dashboard must answer with the version we just built. db/server reasons are
# fatal; feed reasons are a warning (see header, point 4).
check_dashboard() {
  local want="$1" deadline=$(( $(now_s) + HEALTH_TIMEOUT )) j verdict
  while :; do
    j="$(ready_json)"
    verdict="$(printf '%s' "$j" | WANT="$want" python3 -c '
import json, os, sys
try: b = json.load(sys.stdin)
except Exception: print("wait bad-json"); sys.exit()
want = os.environ["WANT"]
r = b.get("reasons") or []
if want and b.get("version") != want: print("wait version=%s" % b.get("version")); sys.exit()
hard = [x for x in r if not str(x).startswith("feed.")]
if hard: print("wait " + ",".join(hard)); sys.exit()
if r: print("feedwarn " + ",".join(r)); sys.exit()
print("ok")
')"
    case "$verdict" in
      ok) say "dashboard ready — version ${want:-?}"; return 0 ;;
      feedwarn*) warn "dashboard is up on ${want:-?} but the feed is not ready yet (${verdict#feedwarn }) — not rolling back for that"; return 0 ;;
    esac
    if [ "$(now_s)" -ge "$deadline" ]; then warn "dashboard never became ready: ${verdict#wait } (last answer: $j)"; return 1; fi
    sleep 5
  done
}

# ── rollback ──────────────────────────────────────────────────────────────────
do_rollback() {
  local reason="$1"
  [ -s "$STATE/last-built" ] || die "nothing to roll back to (no record of the last deploy's images)"
  local from_sha; from_sha="$(cat "$STATE/last-from" 2>/dev/null || true)"
  say "rolling back ($reason): restoring previous images"
  local svc img n=0
  while read -r svc img; do
    [ -n "$img" ] || continue
    if docker image inspect "${img%:*}:prev" >/dev/null 2>&1; then
      docker tag "${img%:*}:prev" "$img"; n=$((n+1)); echo "    $svc  <- ${img%:*}:prev"
    else
      warn "no :prev image for $svc — left as is"
    fi
  done < "$STATE/last-built"
  if [ -n "$from_sha" ] && git cat-file -e "$from_sha^{commit}" 2>/dev/null; then
    # Bind-mounted configs live in the working tree, so it goes back too. The
    # next deploy's `git pull --ff-only` fast-forwards straight past this.
    git reset -q --hard "$from_sha"
    say "code tree back at $(git rev-parse --short HEAD) ($(version_at HEAD))"
  fi
  $DC up -d
  if [ -s "$STATE/last-recreate" ]; then
    # shellcheck disable=SC2046
    $DC up -d --no-deps --force-recreate $(cat "$STATE/last-recreate")
  fi
  : > "$STATE/last-built"; : > "$STATE/last-recreate"
  log_history "rollback	$reason	images=$n	now=$(git rev-parse --short HEAD)"
  say "rollback done — $n image(s) restored"
}

if [ "$CMD" = status ]; then
  echo "code:     $(git rev-parse --short HEAD)  $(version_at HEAD)"
  echo "last ok:  $(cat "$STATE/last-ok" 2>/dev/null || echo '?')"
  echo "rollback: would restore $(wc -l < "$STATE/last-built" 2>/dev/null || echo 0) image(s) to $(cat "$STATE/last-from" 2>/dev/null || echo '?')"
  echo "live:     $(ready_json)"
  echo "recent:"; tail -5 "$HISTORY" 2>/dev/null | sed 's/^/  /' || true
  exit 0
fi

if [ "$CMD" = rollback ]; then
  do_rollback "manual"
  wait_healthy dashboard vela || warn "check the containers: docker compose ps"
  exit 0
fi

# ── deploy ────────────────────────────────────────────────────────────────────
T0=$(now_s)
TO="$(git rev-parse HEAD)"
# Start from the last deploy that passed the health gate — NOT from whatever the
# tree was before this pull. A deploy that failed or was rolled back leaves
# last-ok behind, so re-running picks its changes up again instead of seeing
# "nothing new".
if [ -z "$FROM" ]; then FROM="$(cut -f1 "$STATE/last-ok" 2>/dev/null || true)"; fi
if [ -z "$FROM" ]; then FROM="$SEED"; fi
if [ -z "$FROM" ] || ! git cat-file -e "$FROM^{commit}" 2>/dev/null; then
  warn "no known previous deploy — doing a full deploy"; FULL=1; FROM="$TO"
fi
WANT_VERSION="$(version_at HEAD)"
say "deploying $(git rev-parse --short "$FROM") -> $(git rev-parse --short "$TO") ($WANT_VERSION)"

# Build args the dashboard bakes into its client bundle. Only these — .env.local
# also holds multi-line secrets that a blanket export chokes on.
for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_OWNER_USER_ID NEXT_PUBLIC_TURNSTILE_SITE_KEY APP_PORT; do
  val="$(grep -m1 "^${v}=" .env.local 2>/dev/null | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true)"
  export "${v}=${val}"
done
BUILD_ARGS=(--build-arg "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL"
            --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY"
            --build-arg "NEXT_PUBLIC_OWNER_USER_ID=$NEXT_PUBLIC_OWNER_USER_ID"
            --build-arg "NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY")

# ── plan ──────────────────────────────────────────────────────────────────────
# Output: "MODE full" or "MODE selective", then "BUILD <svc>" / "RECREATE <svc>"
# lines, then "WHY <path> -> <decision>" lines for the log.
plan() {
  local changed version_only=0
  changed="$(git diff --name-only "$FROM" "$TO")"
  if grep -qx 'package.json' <<< "$changed"; then
    # push.ps1 bumps "version" on every push. A diff that is ONLY that is not a
    # dependency change and must not by itself rebuild the dashboard.
    if [ "$(git show "$FROM:package.json" | python3 -c 'import json,sys;d=json.load(sys.stdin);d.pop("version",None);print(json.dumps(d,sort_keys=True))')" = \
         "$(git show "$TO:package.json"   | python3 -c 'import json,sys;d=json.load(sys.stdin);d.pop("version",None);print(json.dumps(d,sort_keys=True))')" ]; then
      version_only=1
    fi
  fi
  $DC config --format json | CHANGED="$changed" VERSION_ONLY="$version_only" ROOT="$ROOT" python3 -c '
import json, os, sys
root = os.path.realpath(os.environ["ROOT"])
d = json.load(sys.stdin)
changed = [p for p in os.environ["CHANGED"].splitlines() if p.strip()]

# Paths that are never part of any image or mount: deploy tooling. They are in
# .dockerignore, so they do not change the dashboard image either.
NOISE = {"push.ps1", "deploy.sh", "dev.ps1", ".gitignore", ".gitattributes"}
if os.environ.get("VERSION_ONLY") == "1":
    NOISE.add("package.json")

def rel(p):
    p = os.path.realpath(p)
    return os.path.relpath(p, root) if p == root or p.startswith(root + os.sep) else None

build_dirs = {}   # "owner-vite/" -> {svc}   (directory owned by ONE build)
mounts = {}       # "deploy/edge/nginx.conf.template" -> {svc}
for name, s in d.get("services", {}).items():
    b = s.get("build")
    if b:
        ctx = rel(b.get("context", "."))
        if ctx is not None and ctx != ".":
            build_dirs.setdefault(ctx.rstrip("/") + "/", set()).add(name)
        elif ctx == ".":
            df = os.path.dirname(b.get("dockerfile") or "Dockerfile")
            if df and df != ".":
                # e.g. deploy/vela/Dockerfile: that folder belongs to vela alone
                build_dirs.setdefault(df.rstrip("/") + "/", set()).add(name)
    for v in s.get("volumes", []) or []:
        if isinstance(v, dict) and v.get("type") == "bind":
            r = rel(v.get("source", ""))
            if r and r != "." and not r.startswith("state"):
                mounts.setdefault(r, set()).add(name)

build, recreate, why, full = set(), set(), [], False
for p in changed:
    if p in NOISE:
        why.append((p, "ignored (tooling/version bump)")); continue
    hit = False
    for dpath, svcs in build_dirs.items():
        if p.startswith(dpath):
            build |= svcs; hit = True; why.append((p, "build " + ",".join(sorted(svcs))))
    for m, svcs in mounts.items():
        if p == m or p.startswith(m.rstrip("/") + "/"):
            recreate |= svcs; hit = True; why.append((p, "recreate " + ",".join(sorted(svcs))))
    if not hit:
        full = True; why.append((p, "FULL (not owned by a single service)"))

print("MODE " + ("full" if full else "selective"))
if not full:
    for s in sorted(build): print("BUILD " + s)
    for s in sorted(recreate - build): print("RECREATE " + s)
for p, w in why[:40]: print("WHY %s -> %s" % (p, w))
if len(why) > 40: print("WHY ... %d more" % (len(why) - 40))
'
}

MODE=full; BUILD_SVCS=(); RECREATE_SVCS=()
if [ "$FULL" = 0 ]; then
  if PLAN="$(plan)"; then
    MODE="$(printf '%s\n' "$PLAN" | awk '$1=="MODE"{print $2}')"
    while read -r k v; do
      case "$k" in BUILD) BUILD_SVCS+=("$v") ;; RECREATE) RECREATE_SVCS+=("$v") ;; esac
    done <<< "$PLAN"
    printf '%s\n' "$PLAN" | awk '$1=="WHY"{sub(/^WHY /,"    ");print}'
  else
    warn "planner failed — doing a full deploy"; MODE=full
  fi
  [ -n "$MODE" ] || MODE=full
fi

if [ "$MODE" = selective ] && [ ${#BUILD_SVCS[@]} -eq 0 ] && [ ${#RECREATE_SVCS[@]} -eq 0 ]; then
  say "nothing deployable changed (tooling / version bump only) — leaving every container running"
  printf '%s\t%s\n' "$TO" "$WANT_VERSION" > "$STATE/last-ok"
  log_history "noop	$WANT_VERSION	$(git rev-parse --short "$FROM")->$(git rev-parse --short "$TO")"
  exit 0
fi

if [ "$MODE" = full ]; then
  say "plan: FULL deploy (every service)"
else
  say "plan: build [${BUILD_SVCS[*]:-}]  recreate [${RECREATE_SVCS[*]:-}] — the trading server is NOT restarted"
fi

# ── snapshot :prev for rollback ───────────────────────────────────────────────
if ! $DC config --format json >/dev/null 2>&1; then
  warn "this docker compose cannot print its config as JSON — deploying, but rollback will NOT be available for this deploy"
fi
: > "$STATE/last-built.new"
while read -r svc img; do
  if [ "$MODE" = selective ]; then
    case " ${BUILD_SVCS[*]:-} " in *" $svc "*) ;; *) continue ;; esac
  fi
  if docker image inspect "$img" >/dev/null 2>&1; then
    docker tag "$img" "${img%:*}:prev"
    echo "$svc $img" >> "$STATE/last-built.new"
  fi
done < <(built_images)

# ── build ─────────────────────────────────────────────────────────────────────
TARGETS=()
[ "$MODE" = selective ] && TARGETS=("${BUILD_SVCS[@]}")
build_once() { $DC build $NOCACHE "${BUILD_ARGS[@]}" "${TARGETS[@]}" 2>&1 | tee "$STATE/build.log"; return "${PIPESTATUS[0]}"; }
if [ "$MODE" = full ] || [ ${#TARGETS[@]} -gt 0 ]; then
  say "building ${TARGETS[*]:-all images}..."
  if ! build_once; then
    if grep -qiE '50[0-9] |gateway|timeout|timed out|TLS handshake|connection reset|i/o timeout|unexpected EOF|toomanyrequests|no such host' "$STATE/build.log"; then
      warn "build failed on what looks like a network/registry error — retrying once in 20s"
      sleep 20
      build_once || { log_history "build-failed	$WANT_VERSION"; die "build failed twice — nothing was restarted, the old version is still live"; }
    else
      log_history "build-failed	$WANT_VERSION"
      die "build failed — nothing was restarted, the old version is still live (log: $STATE/build.log)"
    fi
  fi
fi

# The build is done; from here on a failure means rollback, so record what it
# would restore BEFORE anything restarts.
mv "$STATE/last-built.new" "$STATE/last-built"
printf '%s\n' "$FROM" > "$STATE/last-from"
printf '%s\n' "${RECREATE_SVCS[@]:-}" | grep -v '^$' > "$STATE/last-recreate" || true

# ── restart ───────────────────────────────────────────────────────────────────
say "starting..."
# Plain `up -d` is right for both modes: compose only recreates a container whose
# image or config changed, so an un-built dashboard keeps running untouched.
$DC up -d
if [ ${#RECREATE_SVCS[@]} -gt 0 ]; then
  $DC up -d --no-deps --force-recreate "${RECREATE_SVCS[@]}"
fi

# ── health gate ───────────────────────────────────────────────────────────────
GATE=()
if [ "$MODE" = full ]; then
  GATE=(dashboard vela)
  # Captured first, then grepped: `cmd | grep -q` under pipefail fails at random
  # when grep exits before cmd finishes writing (SIGPIPE), and jobs went unchecked.
  ALL_SVCS="$($DC config --services 2>/dev/null || true)"
  grep -qx jobs <<< "$ALL_SVCS" && GATE+=(jobs)
else
  GATE=("${BUILD_SVCS[@]}" "${RECREATE_SVCS[@]}")
fi
say "waiting for: ${GATE[*]}"
OK=1
wait_healthy "${GATE[@]}" || OK=0
if [ "$OK" = 1 ] && [ "$MODE" = full ]; then check_dashboard "$WANT_VERSION" || OK=0; fi

if [ "$OK" = 0 ]; then
  $DC ps --format '{{.Name}}  {{.Status}}' | sed 's/^/    /'
  if [ "$AUTO_ROLLBACK" = 1 ]; then
    log_history "failed	$WANT_VERSION	mode=$MODE	auto-rollback"
    do_rollback "health gate failed for $WANT_VERSION"
    wait_healthy dashboard vela || true
    die "$WANT_VERSION did not come up healthy and was rolled back. Logs: docker compose logs --since 10m dashboard"
  fi
  log_history "failed	$WANT_VERSION	mode=$MODE	no-rollback"
  die "$WANT_VERSION did not come up healthy (DEPLOY_AUTO_ROLLBACK=0, left in place). Roll back with: bash deploy.sh rollback"
fi

printf '%s\t%s\n' "$TO" "$WANT_VERSION" > "$STATE/last-ok"
docker image prune -f >/dev/null 2>&1 || true
SECS=$(( $(now_s) - T0 ))
NOTE="$(version_note "$WANT_VERSION")"
log_history "ok	$WANT_VERSION	mode=$MODE	build=[${BUILD_SVCS[*]:-all}]	recreate=[${RECREATE_SVCS[*]:-}]	${SECS}s${NOTE:+	note=$NOTE}"
$DC ps --format '{{.Name}}  {{.Status}}' | sed 's/^/    /'
say "done — $WANT_VERSION live in ${SECS}s (roll back with: bash deploy.sh rollback)"
