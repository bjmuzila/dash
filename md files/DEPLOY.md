# Deploy cheat-sheet

Two machines, two git directions. **Never mix them up** — the prompts tell you which window you're in:

- **Windows PowerShell** → prompt `PS C:\Users\Brandon\...>` — where you AUTHOR code. This is the only place you `git push`.
- **VPS (SSH)** → prompt `root@cb-edge-prod:/opt/dashboard#` — where production RUNS. This only ever `git pull`s. It has no GitHub credentials and cannot push.

Rule of thumb: `git push` and `ssh` go in **Windows**. `git pull`, `docker`, `cloudflared`, `ufw` go on the **VPS**.

---

## 1. Push (Windows → GitHub)

In **Windows PowerShell**:

```powershell
cd C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed
git add -A
git commit -m "your message"
git push origin main
```

(Or run `/push` to auto-bump the version + commit + push.)

## 2. Deploy (GitHub → VPS)

SSH from **Windows PowerShell**:

```powershell
ssh root@178.156.137.36
```

Then on the **VPS**, pull and rebuild:

```bash
cd /opt/dashboard
git pull
APP_PORT=$(grep '^PORT=' .env.local | cut -d= -f2-) \
NEXT_PUBLIC_OWNER_USER_ID=$(grep '^NEXT_PUBLIC_OWNER_USER_ID=' .env.local | cut -d= -f2-) \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$(grep '^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=' .env.local | cut -d= -f2-) \
NEXT_PUBLIC_APP_NAME=$(grep '^NEXT_PUBLIC_APP_NAME=' .env.local | cut -d= -f2-) \
docker compose up -d --build
```

> `APP_PORT=...` keeps the host mapping on the app's real port (3002 from `.env.local`).
> Without it, compose falls back to 3001 and the tunnel can't reach the app.

## Verify after deploy

```bash
docker compose ps                               # STATUS healthy, PORTS 127.0.0.1:3002->3002
docker compose logs --tail=30                   # "[SERVER-V2] listening" + "feed started"
curl -s http://127.0.0.1:3002/proxy/health      # {"ok":true,...}
curl -sI https://dash.cbedge.net | head -3      # HTTP/2 200 (through Cloudflare)
```

## Common gotchas

- **PowerShell `curl` is fake** — it's `Invoke-WebRequest` and prompts for a URL. Use `curl.exe` on Windows, or just run curl on the VPS.
- **Pasting into the terminal auto-links `www.foo.net` into a markdown link** — if a config line looks like `[www.x](https://www.x)`, rewrite the file with a Python heredoc instead of pasting the bare URL.
- **`git pull` refuses on the VPS** — if you edited Dockerfile/compose directly on the box, run `git stash` → `git pull` → `git stash pop`. (Cleaner: make the change in the repo and pull it.)
- **Logs/health show old port (3001)** — you rebuilt without `APP_PORT=...`. Re-run with the prefix, or `docker compose up -d --force-recreate`.

## Restart cloudflared (after editing the tunnel config)

```bash
systemctl restart cloudflared
systemctl status cloudflared --no-pager | head -5
```
