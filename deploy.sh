#!/usr/bin/env bash
# Run ON the server: cd /opt/dashboard && ./deploy.sh
# Pulls the latest commit, rebuilds the image, restarts the container.
# Fixes the "git pushed but cbedge.net unchanged" trap: the build only busts
# its cache if new files are actually pulled first.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Fetching latest from GitHub..."
BEFORE=$(git rev-parse HEAD)
git fetch origin
git reset --hard origin/main          # match GitHub exactly (no merge surprises)
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "!!  Server was ALREADY on $AFTER — nothing new was pulled."
  echo "!!  If the site still looks stale, your push didn't reach origin/main,"
  echo "!!  or you're rebuilding the same commit. Forcing a clean rebuild anyway."
  NOCACHE="--no-cache"
else
  echo "==> Updated $BEFORE -> $AFTER"
  NOCACHE=""
fi

echo "==> Building image (build args inline NEXT_PUBLIC_* into the client bundle)..."
# These two ARGs are what your Dockerfile's build stage expects. Without them the
# client bundle ships with empty owner id / Clerk key.
docker compose build $NOCACHE \
  --build-arg NEXT_PUBLIC_OWNER_USER_ID="${NEXT_PUBLIC_OWNER_USER_ID:-}" \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}"

echo "==> Restarting container..."
docker compose up -d

echo "==> Pruning old dangling images..."
docker image prune -f >/dev/null 2>&1 || true

echo "==> Done. Now live: $(git rev-parse --short HEAD)"
echo "==> Hard-refresh cbedge.net (Ctrl+Shift+R) to clear the browser cache."
