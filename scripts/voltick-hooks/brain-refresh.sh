#!/bin/sh
# Local-only (.git/hooks is never pushed, Gnotz never sees it).
# After a sync (merge / pull / rebase) on bzilabranch: rebuild the admin-site
# Brain snapshot from the CB Edge repo's generator, and if it changed, commit
# just that one file so it rides the next push to the fork.
TOP=$(git rev-parse --show-toplevel) || exit 0
GEN="$TOP/../spx-gex-dashboard-tt-fixed/owner-vite/scripts/gen-brain-map.mjs"
[ -f "$GEN" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
[ "$(git rev-parse --abbrev-ref HEAD)" = "bzilabranch" ] || exit 0
VOLTICK_ROOT="$TOP" node "$GEN" --only=voltick >/dev/null 2>&1 || { echo "brain: refresh failed (sync is fine)"; exit 0; }
F=admin-site/brain-data.js
[ -n "$(git status --porcelain -- "$F")" ] || exit 0
GD=$(git rev-parse --git-dir)
# git still holds MERGE_HEAD while post-merge runs, so commit once it's gone.
(
  i=0; while [ -f "$GD/MERGE_HEAD" ] && [ $i -lt 20 ]; do sleep 0.5; i=$((i+1)); done
  git add -- "$F" && git commit --no-verify -q -m "admin-site: refresh brain map" -- "$F" \
    && echo "brain: admin-site/brain-data.js refreshed + committed"
) &
exit 0
