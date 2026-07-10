---
name: dev-server
description: "Start or restart the VPS dev server (port 3003) and print the SSH tunnel command. Trigger with '/dev-server', 'start dev', 'run dev', 'dev server', or when Brandon wants to develop locally against live data."
---

# Dev Server Skill

When this skill fires, output EXACTLY the two blocks below. Do not execute any commands. Brandon runs them.

## How it works

- A second `bzila-dashboard:latest` container runs on port 3003 on the VPS
- It has full Theta data (GEX, greeks, flow, heatmap, all non-TT pages)
- TT/dxLink (options chain) does NOT work — it's Theta-only
- Brandon tunnels port 3003 to localhost and browses http://localhost:3003

## Output this every time

**1 — ON THE VPS** (`root@cb-edge-prod:/opt/dashboard`). Start or restart the dev container:

```bash
docker rm -f dashboard-dev 2>/dev/null; \
docker run -d --name dashboard-dev \
  --network dashboard_default \
  --env-file .env.local \
  -e PORT=3003 \
  -e NODE_ENV=production \
  -e TZ=America/New_York \
  -p 127.0.0.1:3003:3003 \
  bzila-dashboard:latest && \
sleep 5 && docker ps | grep dashboard-dev && curl -s http://127.0.0.1:3003/proxy/health
```

Expected output ends with `{"ok":true,...}`. If it does, proceed to step 2.

**2 — ON YOUR LAPTOP** (Windows PowerShell). Keep this terminal open — closing it kills the tunnel:

```powershell
ssh -N -i $env:USERPROFILE\.ssh\cbedge -L 3003:127.0.0.1:3003 root@178.156.137.36
```

Then open **http://localhost:3003** in your browser.

## What works on :3003
- Home (GEX chart, heatmap, stat bar)
- /greeks, /flow, /es-candles, /traders-dashboard
- /confidence-score, /em, /strike-growth, /fails
- All auth, nav, settings, owner pages

## What does NOT work
- Options chain (TT/dxLink — prod only)
- Anything hitting `/proxy/api/tt/*`

## To stop the dev server
On the VPS:
```bash
docker rm -f dashboard-dev
```

## If the container exits unexpectedly
```bash
docker logs dashboard-dev --tail 40
```

## Note on code changes
The dev container runs the already-built `.next/` from the image. After a code change, push + rebuild prod image, then restart dashboard-dev with step 1 above. There is no hot reload.
