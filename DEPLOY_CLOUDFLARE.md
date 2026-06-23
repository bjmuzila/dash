# Render → VPS + Cloudflare migration

**Architecture after migration**

```
                 clients (browsers)
                        │  HTTPS + WSS  (egress billed by Cloudflare, cheap/free)
                        ▼
                ┌───────────────┐
                │  Cloudflare   │   DNS proxied (orange cloud) + WebSockets on
                │   (edge)      │   + cache rules for /_next/static
                └───────┬───────┘
                        │  Cloudflare Tunnel (outbound from VPS, no open ports)
                        ▼
                ┌───────────────┐
                │   VPS (Node)  │   server-v2/server-with-proxy.js
                │  127.0.0.1:   │   = Next.js + /ws/gex + TT/dxLink feed
                │     3001      │   + in-process schedulers (MVC/EOD/weekly)
                └───────┬───────┘
                        │  TCP 5432 (pg)
                        ▼
                  Postgres (unchanged — Render PG / Neon / Supabase)
```

Nothing in the app or `server-v2` code changes. This is deploy config only.
The single Node process keeps serving Next.js in-process exactly as it does on
Render; we just move the box and put Cloudflare in front of it.

---

## 0. This deployment (locked-in choices)

- **VPS:** Hetzner **CPX21** (3 vCPU / 4 GB / 80 GB), **Ashburn, VA (us-east)**,
  **Ubuntu 26.04**. Server name `cb-edge-prod`, IP **178.156.137.36**.
  Ashburn was chosen on purpose: your Postgres is Render's **Virginia** region
  (`...virginia-postgres.render.com`) and TastyTrade is US-based, so the box
  sits next to both — single-digit-ms DB + feed latency.
- Your domain already on Cloudflare (nameservers pointing at CF).
- Your current Render env vars (recreate them in `.env.local`, ROTATED — see §2b).

> 4 GB RAM is enough for `next build` but not generous. §1 adds a 2 GB swap file
> so the build can't OOM-kill mid-compile.

---

## 1. Provision the VPS (Ubuntu 26.04)

```bash
# ssh root@178.156.137.36   (key-based; accept the host fingerprint once)

apt-get update && apt-get install -y ca-certificates curl git ufw

# 2 GB swap — safety net so `next build` (Next 15 + React 19) can't OOM on 4 GB.
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Docker — UBUNTU repo (not Debian).
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Firewall: with Cloudflare Tunnel you need NO inbound app ports. Keep SSH only.
ufw allow OpenSSH
ufw --force enable
```

> Ubuntu 26.04 is very new — if `$VERSION_CODENAME` isn't yet in Docker's repo,
> substitute the previous LTS codename (e.g. `noble`) in the `echo` line; the
> packages are compatible.

## 2. Get the code + secrets onto the box

```bash
git clone <your-repo-url> /opt/dashboard
cd /opt/dashboard

# Recreate your Render env here. server-v2 reads .env.local at boot.
# Include EVERYTHING Render had: TT_* / DXLINK creds, DATABASE_URL(s),
# CLERK_* keys, NEXT_PUBLIC_OWNER_USER_ID, MAINTENANCE_MODE, ES_SEED, etc.
nano .env.local
```

`.env.local` must contain at minimum (names per your existing Render config):

# PORT: server-v2 binds this and Next's internal rewrite reads the same value,
# so they always match. Use 3001 (or keep 3002 from your Render config — just
# set APP_PORT to the same number, see below). Update the cloudflared
# config.yml `service:` port + the compose APP_PORT to match this.
```
PORT=3001
NODE_ENV=production
DATABASE_URL=postgres://...          # + any other pg URLs server-v2 uses
NEXT_PUBLIC_OWNER_USER_ID=user_xxx   # also passed as build arg (step 3)
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
# ...all remaining TT/dxLink/feed secrets exactly as on Render
```

> RENDER_DEPLOY_HOOK_URL no longer applies (the owner "redeploy" button). Either
> drop it or repoint /proxy/redeploy at a redeploy script — see step 6.

## 2b. ROTATE SECRETS (do this — they were exposed)

The `.env.local` secrets were shared in plaintext during setup, so treat them as
compromised and rotate before/at cutover. Put the NEW values in the box's
`.env.local`, not the old ones.

- **Postgres password** — Render dashboard → your DB → Reset password; paste the
  new `DATABASE_URL` (keep the `virginia-postgres.render.com` host).
- **TastyTrade** — revoke + reissue the OAuth **refresh token** and
  **client secret** in your TT OAuth app; update `TT_REFRESH_TOKEN` /
  `TT_CLIENT_SECRET`.
- **Render API key** (`RENDER_API_KEY`, `rnd_...`) — Render account → API Keys →
  regenerate.
- **Discord** — regenerate the **bot token** (Discord Dev Portal → Bot → Reset
  Token); update `DISCORD_BOT_TOKEN`.
- **Google service account** — IAM → delete the leaked key, create a new JSON
  key; update `GOOGLE_PRIVATE_KEY` (one line, literal `\n`).
- **Clerk** — keys are `*_test_` (dev tier); rotate if/when you move to prod
  Clerk keys.
- Set `WAITLIST_ADMIN_SECRET` to a real random value (it's still `change-me...`).

You've done this before (memory: "Step 4 secrets complete"). Do NOT commit
`.env.local` — it's already in `.gitignore`/`.dockerignore`.

## 3. Build + run

```bash
# Pass the build-time public var so the client bundle bakes the owner id in.
NEXT_PUBLIC_OWNER_USER_ID=$(grep '^NEXT_PUBLIC_OWNER_USER_ID=' .env.local | cut -d= -f2-) \
  docker compose build

# APP_PORT must equal PORT in .env.local so the published port maps correctly.
APP_PORT=$(grep '^PORT=' .env.local | cut -d= -f2-) docker compose up -d
docker compose logs -f --tail=50      # watch for "[SERVER-V2] listening ..."
                                      # and "Tastytrade/dxLink feed started"
```

Confirm locally on the box (no Cloudflare yet):

```bash
curl -s http://127.0.0.1:3001/proxy/health      # {"ok":true,...}
```

## 4. Cloudflare Tunnel (origin connection, no open ports)

```bash
# On the VPS:
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
dpkg -i cloudflared.deb
cloudflared tunnel login                       # opens a browser auth URL
cloudflared tunnel create dashboard
```

Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: dashboard
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: app.yourdomain.com
    service: http://127.0.0.1:3001
    originRequest:
      # WebSockets (/ws/gex) work over the tunnel out of the box, but be explicit:
      noTLSVerify: true
  - service: http_status:404
```

Route DNS and run as a service:

```bash
cloudflared tunnel route dns dashboard app.yourdomain.com
cloudflared service install
systemctl enable --now cloudflared
```

This creates a **proxied (orange-cloud) CNAME** `app.yourdomain.com` →
tunnel automatically. Client egress now rides Cloudflare's network.

## 5. Cloudflare dashboard settings (one-time)

In the Cloudflare dashboard for your zone:

1. **Network → WebSockets: ON.** (Required for `/ws/gex`.) On by default on
   most plans; verify it.
2. **SSL/TLS → Overview → Full.** (Tunnel handles origin encryption; you do not
   need an origin cert with a tunnel.)
3. **Caching → Cache Rules → add a rule:**
   - *Cache `/_next/static/*` and other immutable assets:*
     `URI Path starts with /_next/static` → **Eligible for cache**, Edge TTL
     "Respect origin" (Next sets immutable `Cache-Control` on these). This is
     where most of your egress savings comes from — assets served from CF edge,
     not your VPS.
   - *Bypass cache for live + API paths:* a rule matching
     `URI Path starts with /ws` OR `/proxy` OR `/api` → **Bypass cache**.
     (WS and JSON feeds must never be cached.)
4. **Speed → Optimization:** Brotli ON (the app already sets `compress: true`,
   CF Brotli further shrinks egress).

## 6. (Optional) Replace the owner "redeploy" button

The `/proxy/redeploy` route POSTs to `RENDER_DEPLOY_HOOK_URL`. On the VPS,
either remove the button's expectation or wire a tiny pull-and-restart:

```bash
# /opt/dashboard/redeploy.sh
cd /opt/dashboard && git pull && \
  NEXT_PUBLIC_OWNER_USER_ID=$(grep '^NEXT_PUBLIC_OWNER_USER_ID=' .env.local | cut -d= -f2-) \
  docker compose build && docker compose up -d
```

Trigger it however you like (cron-on-webhook, a small authenticated endpoint,
or just SSH + run the script). Not required for the migration to work.

## 7. Cutover

1. Bring the VPS fully up and verified (steps 1–5) **before** touching DNS for
   your real hostname. Test against `app.yourdomain.com` (tunnel) while Render
   still serves your production hostname.
2. When green, move your production hostname's DNS to the tunnel (repeat the
   `cloudflared tunnel route dns` for the real hostname, or CNAME it to the
   tunnel) — proxied/orange.
3. Watch the dashboard live for a full session: WS reconnects, GEX/flow update,
   a scheduler fires (MVC every 5m is the quickest to confirm).
4. Suspend the Render service (keep it a few days as rollback), then delete.

---

## Verification checklist

- [ ] `curl https://app.yourdomain.com/proxy/health` → `{"ok":true}` via CF.
- [ ] Browser: `/ws/gex` connects (Network tab shows `101 Switching Protocols`,
      status updates flowing). WSS, not blocked.
- [ ] `cf-cache-status: HIT` on a `/_next/static/...` asset (egress on CF).
- [ ] `cf-cache-status: BYPASS`/`DYNAMIC` on `/ws`, `/proxy/*`, `/api/*`.
- [ ] Clerk sign-in works (publishable + secret keys present in `.env.local`).
- [ ] Postgres reachable from the VPS (no pg pool errors in logs).
- [ ] An ET-gated scheduler fires on schedule (TZ=America/New_York in container).
- [ ] Render **Outbound Bandwidth** stops climbing; Cloudflare Analytics shows
      the traffic instead. (Per your past finding: watch the provider bandwidth
      meter, not app logs — the egress leak logs nothing.)
```
