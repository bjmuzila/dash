# Voltick brain hooks

Keeps `Voltick/admin-site/brain-data.js` (the admin site's Brain page) current
every time you sync `bzilabranch` with Gnotz's main.

Install once, from PowerShell:

    & "C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\scripts\voltick-hooks\install.ps1"

- `post-merge` (merge / pull) and `post-rewrite` (rebase) call `brain-refresh.sh`.
- It runs `owner-vite/scripts/gen-brain-map.mjs --only=voltick` from this repo,
  and if `brain-data.js` changed, commits only that file as
  "admin-site: refresh brain map". Your next push to the fork carries it.
- Only on `bzilabranch`. Never fails a sync. Lives in `.git/hooks`, so it is
  never pushed. Re-run install.ps1 if you re-clone Voltick.
