# Affiliate creative images

> Kept OUT of `public/` deliberately. Anything under `public/` is copied to the
> web root at build time, so a README living beside the images would be served
> at `https://affiliate.cbedge.net/creatives/README.md` — a public page listing
> internal paths and build commands.

Drop real screenshots of the terminal in this folder. Until a file is here, its
card on `affiliate.cbedge.net/dashboard/creatives` renders as an empty frame
naming the path it wants, and its **Post to X** / **Download PNG** buttons stay
disabled — so nobody can share a blank card. **Copy text** stays live, because
the wording is usable with a screenshot the affiliate takes themselves.

## The four files

| File            | Card               | What to capture                                                        |
|-----------------|--------------------|------------------------------------------------------------------------|
| `gex-walls.png` | GEX heatmap        | The SPX GEX ladder with CB / CW / PW badges visible                    |
| `es-em.png`     | ES candles + EM    | Overnight ES with the estimated-move band drawn on                     |
| `phone.png`     | Phone build        | A `/m/*` page on a 390px viewport — the heatmap or the chain reads best |
| `chain.png`     | Options chain      | The chain with greeks, ideally mid-session so the numbers look alive   |

Filenames are matched exactly, and they are set server-side in
`server-v2/affiliate-routes.cjs` → `creativeTemplates()`. Renaming a file means
editing that function too.

## Requirements

- **1200 × 675** (16:9). This is what X renders inline without cropping. Other
  sizes are `object-fit: cover`-ed, so anything else gets edges cut off.
- **PNG.** The download path re-encodes through a canvas anyway, but the source
  should be lossless — a JPEG screenshot of a dark UI bands badly.
- **No live account data.** No P&L, no balance, no order tickets, no email
  addresses or usernames in a toolbar. These go on public timelines.
- **Leave the bottom-right corner clear.** The affiliate's `CODE XXXX` badge is
  composited there at download time and will sit on top of whatever is beneath
  it.
- Capture at 2× if you can and downscale to 1200 × 675 — a 1× screenshot of a
  dark chart looks soft after X re-encodes it.

## Adding them

```bash
# on the laptop
cp your-shot.png affiliate-vite/public/creatives/gex-walls.png
.\push.ps1
```

Vite copies `public/` to the root of `dist/` at build time, so the file is
served at `/creatives/gex-walls.png` by the affiliate container's nginx. It
needs a rebuild of that image to appear:

```bash
# on the VPS, if you are not doing a full push
cd /opt/dashboard && docker compose build affiliates && docker compose up -d affiliates
```

## Adding a fifth card

1. Put the PNG here.
2. Add an entry to `creativeTemplates()` in `server-v2/affiliate-routes.cjs`
   with an `id`, a `label`, the `image` path, and the post `text`.

No front-end change is needed — the page renders whatever that function returns.
The copy lives server-side on purpose, so wording can be fixed without a SPA
deploy.
