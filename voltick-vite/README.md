# voltick-vite · voltick.cbedge.net

The sandbox for the Voltick and CB Edge merger. Its own Vite SPA, its own nginx,
its own subdomain, on the same box as everything else. Nothing here is customer
facing and nothing here is load bearing.

## Access

**Cloudflare Access, in front of the container.** One-time-PIN on an email
allowlist. There is no sign-in code in this app: adding or revoking someone is a
change in the Cloudflare dashboard and nothing here rebuilds.

That is deliberate. An allowlist living in a bundle means a redeploy every time
the list changes, and an allowlist living in the backend means a new endpoint in
`server-v2` for a sandbox.

**One list, two hostnames.** `voltick.cbedge.net` and `demo.cbedge.net` admit the
same people: Brandon plus whoever he adds. So the allowlist lives in a reusable
**Access Group**, not typed into each application, or the two drift and someone
revoked from one keeps the other.

Zero Trust → Access → **Groups** → Add a group:

| Field | Value |
|---|---|
| Group name | `CB Edge insiders` |
| Include → Emails | `bjmuzila@gmail.com`, plus each email you add |

Then one self-hosted application per hostname (`voltick.cbedge.net`,
`demo.cbedge.net`), each with a single Allow policy whose only Include is the
**`CB Edge insiders`** group. Session 24 hours, One-time PIN as the login method.
Removing an email from the group kills both links at once.

Free plan covers 50 Access users, so this costs nothing.

If a gate ever does move into the app, it fails **closed**, the way
`owner-vite/src/AuthGate.tsx` does: any error blocks rather than exposing the
app.

## /demo · the owner console

The first entry on the contents board is the owner console demo, at
**`voltick.cbedge.net/demo/`**. It is the same build that answers
`demo.cbedge.net`: `nginx.conf` proxies `/demo/` to the `demo-web` container over
the compose network rather than copying the HTML into this image, so
`node demo-owner/build.mjs` plus a `demo-web` rebuild updates both hostnames and
this image never holds a second, staler copy of a 290KB page.

It is listed in `nav.ts` with `external: true`, which keeps it out of the React
router and renders it as a real anchor. A client-side `Link` to a path nginx owns
would route internally and land on `NotFound`.

## Shape

```
voltick-vite/
  Dockerfile        node build stage → nginx
  nginx.conf        listen 8088; /api /proxy /ws → dashboard:3002; /demo/ → demo-web:8087
  src/
    theme.ts        the Voltick tokens. Import them, never hand-mint a hex.
    index.css       the aurora, hover, focus, selection
    lib/nav.ts      THE CONTENTS LIST. Home renders it, App routes from it.
    pages/registry.ts   key → lazy() import
    pages/          one file per page
    components/     Shell (the bar), PageCard (PageShell, Card, Chip)
```

## Adding a page · two edits

1. An item in `src/lib/nav.ts` with a `key`, a `path`, a `label` and a one line
   `note`.
2. That same `key` in `src/pages/registry.ts`, pointing at a `lazy()` import.

Miss the second and the route renders `Placeholder`, which is the intended state
for something listed but not yet written. There is no third edit: the route is
generated from the same array the contents board renders, so a link and the route
that answers it cannot drift apart.

For something nginx serves rather than the SPA (another container, a static file,
a Next route), mark the item `external: true` and skip step 2. It then gets no
router entry and renders as a plain anchor, so the click is a real navigation.

## Design rules that are defects when broken

They are restated at the top of `src/theme.ts` and rendered live at
`/design-system` and `/colours`. In short:

1. A reserved colour means exactly one thing. Import the token. A near-miss hex
   is worse than a reuse.
2. No grey text. Secondary information is size, weight, spacing, position.
3. No em-dashes in anything a user reads. Middle dot, comma, colon, parentheses.
   Code comments are exempt.
4. Never buy, sell, signal, entry, target, stop or prediction. Mechanics and
   locations only.
5. Dark only.

The full reference is `md files/VOLTICK-DESIGN-SYSTEM.md`. Voltick's own
`web/src/theme.jsx` is the upstream source of truth; when the two disagree, that
file wins and `src/theme.ts` gets updated.

## Local dev

```bash
cd voltick-vite
npm install
npm run dev            # http://localhost:5175
```

`/api`, `/proxy` and `/ws` are proxied to `VITE_BACKEND` (default
`http://localhost:3001`, the repo-root `npm run dev`). To point dev at prod,
set `VITE_BACKEND=https://cbedge.net` and paste an authenticated `document.cookie`
into `BACKEND_COOKIE` in `voltick-vite/.env` (not `VITE_` prefixed, so it stays
server side and never ships to the bundle).

`/feed-check` exists to prove the reverse proxy is wired: a path that answers
with `text/html` is not proxied, it fell through to nginx's SPA fallback.

## Deploy

Part of the root `docker-compose.yml` as the `voltick` service on
`127.0.0.1:8088`. Reached only through the Cloudflare Tunnel. On the VPS, add to
`/etc/cloudflared/config.yml` **above** the catch-all 404 rule:

```yaml
- hostname: voltick.cbedge.net
  service: http://127.0.0.1:8088
```

then:

```bash
cloudflared tunnel route dns <tunnel> voltick.cbedge.net
systemctl restart cloudflared
docker compose build voltick && docker compose up -d voltick
```

`/demo/` needs `demo-web` running, which it already is for `demo.cbedge.net`.
Compose declares `depends_on: demo-web`, so `up -d voltick` starts it if it is
not.

Finally create the Cloudflare Access application for `voltick.cbedge.net` with a
single Allow policy on the **`CB Edge insiders`** group described above.
**Create it before routing DNS.** Until that policy exists the subdomain is open
to anyone who knows the URL, and `/demo/` behind it is the owner console layout.
