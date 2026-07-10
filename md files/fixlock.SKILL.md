---
name: fixlock
description: "Heal package-lock.json drift (the recurring `npm ci` picomatch error) by running a full lock regeneration and verifying it against `npm ci`. Trigger with \"/fixlock\", \"fix the lock\", \"lock drift\", \"npm ci fails\", or when a VPS Docker build shows `lock file's picomatch@X does not satisfy picomatch@Y`. Unlike push-to-github, this skill DOES run npm — but never git push or deploy."
---

# Fix lock drift (/fixlock)

## When to use

VPS Docker build (or local `npm ci`) fails with:

```
npm error `npm ci` can only install packages when your package.json and package-lock.json ... are in sync.
npm error Invalid: lock file's picomatch@2.3.2 does not satisfy picomatch@4.0.4
```

This is transitive drift: package.json didn't change, but a sub-dependency moved.
`npm install --package-lock-only` does NOT fix it (proven in prod) — only a full
regen does.

## What this skill does

Runs the full lock regeneration and verifies it. It runs `npm`, but NEVER `git push`,
`git commit`, `docker`, `ssh`, or `push.ps1`. After it succeeds, hand control back to
the user to commit + deploy.

## Run this

```powershell
cd C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed
rm -r -force node_modules
rm package-lock.json
npm install
npm ci --dry-run
```

- If `npm ci --dry-run` **succeeds**: the lock is now correct. Report success and tell
  the user to commit + push:

  ```powershell
  git add package-lock.json
  git commit -m "fix: full lock regen (transitive drift)"
  .\push.ps1
  ```

- If `npm ci --dry-run` **still fails** after regen: stop. The conflict is in
  package.json itself (incompatible version ranges) — do not push. Report the
  conflicting package and let the user resolve the version pin.

## Notes

- push.ps1 already runs this same dry-run gate + auto-regen before every deploy, so a
  normal `.\push.ps1` self-heals. Use `/fixlock` when you want to heal the lock WITHOUT
  deploying (e.g. to inspect the diff first).
- The EBADENGINE warnings (Supabase wants Node >=22, image is Node 20) are unrelated and
  harmless; fix later by bumping the Dockerfile base to `node:22-bookworm-slim`.
