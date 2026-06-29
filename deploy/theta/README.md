# Theta Terminal — VPS deploy (doc §7)

Adds the Theta Terminal as a sibling Docker service so `server-v2` (in the
`dashboard` container) gets options data over the compose network. Futures stay
on TT/dxLink — this service only backs `DATA_SOURCE=theta`.

## Files
- `Dockerfile.theta` — `eclipse-temurin:21-jre`; **downloads** `ThetaTerminalv3.jar`
  at build time from `https://download-unstable.thetadata.us/ThetaTerminalv3.jar`
  (the jar is gitignored, so it's not copied from the repo). Runs it reading the
  API key from the `THETA_DATA_API_KEY` env var.
- `compose.theta.yml` — the `theta-terminal` service + the env/depends_on lines to
  add to the existing `dashboard` service.

## One-time apply (on the VPS, in `/opt/dashboard`)
1. **Secrets** — add to `/opt/dashboard/.env.local` (gitignored, never via git pull):
   ```
   THETA_DATA_API_KEY=<your PRO key>
   DATA_SOURCE=theta          # omit / set tt to keep options on TastyTrade
   ```
2. **Bring up the terminal:**
   ```
   docker compose -f compose.yml -f deploy/theta/compose.theta.yml up -d --build theta-terminal
   ```
3. **Wire + recreate the dashboard** (after adding the env/depends_on block from
   `compose.theta.yml` to the `dashboard` service):
   ```
   docker compose up -d --force-recreate dashboard
   ```
4. **Verify:**
   ```
   docker compose logs -f theta-terminal   # → "Subscriptions: ... Options: PROFESSIONAL"
   docker compose logs dashboard | grep DATA_SOURCE   # → options provider = THETA
   ```

## Rollback (instant, no code change)
Set `DATA_SOURCE=tt` in `.env.local` and `docker compose up -d --force-recreate dashboard`.
The terminal can keep running; nothing reads it in `tt` mode.

## Notes
- **Health:** `restart: unless-stopped` + a 30s REST healthcheck. `start_period`
  is 40s because the bootstrap jar downloads the runtime + auths on first launch.
- **Degrade-don't-crash:** if the terminal dies, all Theta REST/WS calls in
  server-v2 are `.catch()`'d → OI/greeks go empty, BS fallback + prior-value
  guards hold, the dashboard stays up. Add an alert on the healthcheck if you
  want to be paged.
- **Bandwidth:** Theta is one server→terminal socket; it does NOT multiply per
  browser tab, so the old Render per-tab bandwidth-leak class doesn't recur here.
- **Index tier:** SPX/VIX spot stays on dxLink until the Theta Index tier is
  upgraded from FREE — no spot dependency on this service yet.
