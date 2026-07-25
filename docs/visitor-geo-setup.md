# Visitor geolocation — setup and data flow

The Control Panel's **Unique visitors · by country** choropleth is fed by
Cloudflare's edge geolocation. Nothing in the app performs an IP lookup itself,
and no third-party geoIP service is involved.

## Data flow

```
visitor → Cloudflare edge → VPS → dashboard container
             │
             └─ managed transform adds cf-ipcountry / cf-region / cf-ipcity
                        │
                        ▼
        app/api/page-status  (public, fires on every page load)
                        │  clientIp() + clientGeo()
                        ▼
        page_visits (ip, country, region, city, user_id, path, created_at)
                        │  newest 5,000 rows only
                        ▼
        app/api/page-visits  (owner-gated read)
                        │
                        ▼
        owner-vite ControlPanel → <VisitorMap rows={visits} />
```

## One-time Cloudflare setup

Until this is switched on, `country`/`region`/`city` are written as `NULL` and
the map renders an all-grey world with every load counted as "unmapped".

1. Cloudflare dashboard → select the **cbedge.net** zone.
2. **Rules → Transform Rules → Managed Transforms**.
3. Enable **Add visitor location headers**.

That adds `cf-ipcity`, `cf-ipcountry`, `cf-ipcontinent`, `cf-iplatitude`,
`cf-iplongitude`, `cf-region`, `cf-region-code`, `cf-metro-code`,
`cf-postal-code`, and `cf-timezone` to every request forwarded to the origin. We
persist only country, region, and city — latitude/longitude are deliberately not
stored, since country-level resolution is all the map needs and lat/long is
meaningfully more sensitive.

No API token or env var is required. `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID`
are used by `/api/cloudflare-metrics` (edge egress) and are unrelated to this.

### Verifying it's on

From any machine, after the transform is enabled:

```bash
curl -s -o /dev/null -D - https://cbedge.net/api/keepalive
```

then load any page in a browser and check the newest row:

```sql
SELECT created_at, path, country, region, city
FROM page_visits
ORDER BY id DESC
LIMIT 5;
```

If `country` is still NULL on brand-new rows while the transform is on, the
headers are being dropped between the edge and the Next container — check the
VPS nginx/reverse-proxy config for a `proxy_set_header` block that whitelists
headers rather than passing them through.

## Sentinel values

- `XX` — Cloudflare could not geolocate the IP.
- `T1` — Tor exit node.

Both are stored verbatim and grouped under "unmapped" in the map footer rather
than being drawn as countries.

## Retention

`page_visits` self-prunes to the newest 5,000 rows on every insert, so geo data
ages out with the rest of the visit log. There is no separate retention job.

## Regenerating the map geometry

The world outline is vendored, not fetched from a CDN:

- `owner-vite/public/countries-110m.json` — world-atlas@2, 110m (~105 KB)
- `owner-vite/src/lib/countryMaps.ts` — feature id ↔ ISO alpha-2 + country names

Both are generated. To rebuild (only needed for a different resolution or a newer
ISO country list):

```bash
cd owner-vite
npx -y -p world-atlas@2 -p i18n-iso-countries node scripts/gen-country-maps.mjs
```

Three features in the 110m dataset (Kosovo, N. Cyprus, Somaliland) have no ISO
numeric id. Kosovo is mapped by name to `XK`; the other two have no Cloudflare
country code and always render as no-data.

## Privacy

`app/privacy/page.tsx` discloses coarse, IP-derived location under "Information
collected automatically" and in the CCPA categories paragraph. If the stored
fields ever expand (latitude/longitude, postal code), that disclosure needs to
expand with them.
