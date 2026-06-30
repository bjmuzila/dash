---
name: push-to-github
description: "Print the push.ps1 deploy command plus manual fallback blocks for GitHub + VPS — prompts only, never executed. Trigger with \"/push-prompts\", \"push prompts\", \"give me the push commands\", or when the user wants the deploy steps to copy-paste themselves. This skill NEVER runs git, npm, docker, ssh, or push.ps1 — it only outputs the blocks for the user to run on their own machine and VPS."
---

# Push (one-command deploy via push.ps1)

## What this skill does

Brandon's real deploy entrypoint is `push.ps1` in the repo root. It fails fast
on SSH first (no hanging password prompts), syncs `package-lock.json` only when
package files changed (via `npm install --package-lock-only`, deterministic with
Docker's `npm ci`), commits, pushes `main`, promotes to `prod`, and SSH-deploys
on the VPS via `bash -s` over stdin (avoids the CRLF `\r` quoting bug). The local
build gate is OFF by default — the VPS Docker build is the authoritative gate, so
the old double-build (local + VPS) is gone. This skill outputs the one-liner to
run it, plus manual fallback blocks if the automated deploy fails partway.

## Hard rules

- **Never execute** any of these commands. Output them as text blocks only.
  Brandon runs push.ps1 himself. Do not drive his machine via computer-use.
- Do not run `git`, `npm`, `docker`, `ssh`, or `push.ps1` yourself.

## Flags

- `.\push.ps1` — normal fast deploy (no local build; VPS Docker build gates live)
- `.\push.ps1 -LocalBuild` — add a local `npm run build` pre-flight gate
- `.\push.ps1 -NoCache` — force a clean VPS image rebuild (after dependency changes)

## Normal case — output this

```powershell
cd C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed
.\push.ps1
```

If PowerShell blocks it as unsigned (file downloaded/copied in), run once:

```powershell
Unblock-File .\push.ps1
```

That's the whole deploy. push.ps1 does, in order:
1. Auto-version `vMonth.Day.N` (Nth deploy of the day) + bump package.json
2. Fail-fast SSH check (`BatchMode=yes`, `ConnectTimeout=10`) — if the key isn't
   loaded or the box is down, stops immediately before building/committing
3. Sync lock **only if** package.json/package-lock.json changed
   (`npm install --package-lock-only` — stays in step with Docker `npm ci`)
4. Local build gate is SKIPPED by default (pass `-LocalBuild` to enable)
5. `git add -A`, commit, push `main`
6. Merge `main` → `prod`, push `prod`
7. SSH to `root@178.156.137.36` (key `~/.ssh/cbedge`) → pipes a plain
   LF-only command list to `bash -s` on the VPS (git pull, docker compose
   build, up -d, ps) — Docker layer cache keeps the build incremental

If SSH isn't ready, fix it once:

```powershell
ssh-add $env:USERPROFILE\.ssh\cbedge
```

After it finishes, watch logs for `[READY] … GEX broadcast enabled`:

```powershell
ssh -i $env:USERPROFILE\.ssh\cbedge root@178.156.137.36 "cd /opt/dashboard; docker compose -f docker-compose.yml -f deploy/theta/compose.theta.yml logs -f"
```

## Fallback — if the SSH deploy step fails

Code is already on GitHub (steps 1–6 ran). Deploy manually on the VPS via
Hetzner console (console.hetzner.cloud → server → `>_`) or `ssh root@178.156.137.36`:

```bash
cd /opt/dashboard
git pull
docker compose -f docker-compose.yml -f deploy/theta/compose.theta.yml build
docker compose -f docker-compose.yml -f deploy/theta/compose.theta.yml up -d
docker compose -f docker-compose.yml -f deploy/theta/compose.theta.yml ps
```

If `git pull` says "Already up to date," the push steps didn't run — stop and check.

## RESOLVED — the picomatch `npm ci` error (do NOT chase the lock file)

Old signature in the VPS build log:

```
npm error Invalid: lock file's picomatch@2.3.2 does not satisfy picomatch@4.0.4
```

Root cause: a **Windows-generated** package-lock.json does not satisfy `npm ci` on
**Linux** (npm resolves picomatch differently per-OS). It is NOT transitive drift and
it CANNOT be fixed by regenerating the lock on Windows. It was also never fatal — the
build completed anyway.

Permanent fix (2026-06-30): the **Dockerfile** now runs `npm install --no-audit
--no-fund` instead of `npm ci`, so it resolves correctly per-platform and the error is
gone. push.ps1 no longer does any local lock check. **Nothing to do here anymore.**

If the error ever reappears, it means someone put `npm ci` back in the Dockerfile —
change it back to `npm install`. Do not regenerate the lock on Windows; that never
worked. (If exact-lock installs are ever required, regenerate the lock inside a Node 20
Linux container so it matches Docker.)

If that last `npm ci` succeeds locally, commit and re-run push.ps1:

```powershell
git add package-lock.json
git commit -m "fix: full lock file regeneration"
.\push.ps1
```

## Rollback if broken (on VPS)

```bash
cd /opt/dashboard
git reset --hard HEAD~1
docker compose -f docker-compose.yml -f deploy/theta/compose.theta.yml build
docker compose -f docker-compose.yml -f deploy/theta/compose.theta.yml up -d
```
