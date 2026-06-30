---
name: push-to-github
description: >
  Print the exact command blocks to push the dashboard to GitHub and deploy on
  the VPS — prompts only, never executed. Trigger with "/push-prompts", "push
  prompts", "give me the push commands", or when the user wants the deploy steps
  to copy-paste themselves. This skill NEVER runs git, npm, docker, or ssh — it
  only outputs the blocks for the user to run on their own machine and VPS.
---

# Push Prompts (copy-paste deploy)

## What this skill does

Outputs the full push + VPS-deploy command sequence as copy-paste blocks for the
user to run themselves. It is a **prompts-only** skill.

## Hard rules

- **Never execute** any of these commands. Do not call Bash, the sandbox shell,
  desktop control, or SSH to run them. Output them as text blocks only.
- Do not attempt `git`, `npm`, `npx`, `docker`, or `ssh` yourself.
- Before printing, optionally Read `package.json` to confirm it is valid JSON and
  the `version` field is a clean string — if it is malformed, warn the user first
  (a broken package.json breaks the version-bump step).
- Present the blocks **in order** and tell the user step 2 (build) is a hard gate:
  if it errors, stop and do not push.
- The version-bump line in step 1 MUST stay a single statement on one line — do
  not reformat it so the pipe wraps onto its own line.

## Output exactly these blocks

**Step 1 — version, commit (PowerShell, in the repo):**

```powershell
$repoRoot = "C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed"
$now = Get-Date
cd $repoRoot
git checkout main

# Auto-version v<M>.<D>.<N> — Nth deploy of the day
$prefix = "v$($now.Month).$($now.Day)."
$deploysToday = (git log --since="$($now.ToString('yyyy-MM-dd')) 00:00:00" --grep="^$([regex]::Escape($prefix))" --oneline | Measure-Object -Line).Lines
$version = "$prefix$($deploysToday + 1)"

# Bump package.json version (SINGLE statement — do not let this wrap into a bare pipe)
$pkg = Get-Content "$repoRoot\package.json" -Raw | ConvertFrom-Json; $pkg.version = $version; ($pkg | ConvertTo-Json -Depth 100) | Set-Content "$repoRoot\package.json"
Write-Host "Version: $version" -ForegroundColor Cyan

git add -A
git commit -m "$version"
```

**Step 2 — typecheck + build (must pass before pushing):**

```powershell
npx tsc --noEmit
npm run build
```

**Step 3 — push main → promote prod (only if step 2 was clean):**

```powershell
git push origin main
git checkout prod
git merge main
git push origin prod
git checkout main
```

**Step 4 — deploy on the VPS. SSH in first:**

```
ssh root@178.156.137.36
```

then on the VPS:

```bash
cd /opt/dashboard
git pull
docker compose -f compose.yml -f deploy/theta/compose.theta.yml build
docker compose -f compose.yml -f deploy/theta/compose.theta.yml up -d
docker compose -f compose.yml -f deploy/theta/compose.theta.yml ps
```

**Step 5 — rollback if broken (on VPS):**

```bash
cd /opt/dashboard
git reset --hard HEAD~1
docker compose -f compose.yml -f deploy/theta/compose.theta.yml build
docker compose -f compose.yml -f deploy/theta/compose.theta.yml up -d
```

## After printing

Remind the user: run step 1, then step 2; if step 2 throws, stop and paste the
error before pushing. After the VPS deploy, watch `docker compose ... logs` for
`[READY] … GEX broadcast enabled`.
