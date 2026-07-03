# Budget UI — card & surface style

The visual language used on `/owner/budget`. Everything sources color from
`HOME_THEME` (`components/shared/homeTheme.ts`) plus two page-local accents, so
nothing is a stray hardcoded hex.

## Palette

| Token | Value | Use |
|---|---|---|
| `HOME_THEME.bg` | `#05060A` | Page background |
| `HOME_THEME.panel` | `#0D1119` | Opaque panel / sticky header fill |
| `HOME_THEME.panelBg` | `rgba(13,17,25,0.45)` | Frosted card base (with blur) |
| `HOME_THEME.text` | `#FFFFFF` | Primary text |
| `HOME_THEME.muted` | `#FFFFFF` (used dimmer via size/weight) | Labels, secondary |
| `HOME_THEME.border` | `rgba(255,255,255,0.10)` | Hairline borders |
| `HOME_THEME.green` | `#8ECAE6` | Income / positive net |
| `HOME_THEME.orange` | `#FB8501` | Projection line |
| **Light blue** | `#7dd3fc` | Card highlight, AUTO chip, selection ring |
| **Soft red** | `#f4948e` | Amounts, deficits, delete accent |

Two deliberate page-local constants:

- `LIGHT_BLUE = "#7dd3fc"` — the single accent. Replaces the old rotating
  orange/purple/green/red per-card accents.
- `SOFT_RED = "#f4948e"` — a desaturated red. The theme's `#EF4444` reads harsh
  on the dark table, so every negative value, deficit tint, and delete control
  uses this instead.

## Cards

There are two card generations. The **classic** card is the original
budget-register look; the **dissolve** card is the newer treatment introduced on
`/gex2`, where the surface has no edge at all and feathers into the page.

### Classic card (register / tables)

**Base card** (`card()`): frosted dark surface, no accent.

```
background: HOME_THEME.panelBg;   /* rgba(13,17,25,0.45) */
backdropFilter: blur(16px);
borderRadius: 18px;
border: 1px solid HOME_THEME.border;
boxShadow: 0 18px 40px rgba(0,0,0,0.22);
```

**Highlighted card** (`cardAccent()`): same card + a soft light-blue glow on the
body. No top accent bar (the bar was removed) — the highlight lives inside the
card as a faint radial.

```
...card();
background: radial-gradient(circle at 50% 0%,
              rgba(126,211,252,0.10) 0%, transparent 60%),
            HOME_THEME.panelBg;
```

### Dissolve card (glass / chart panels)

The newer look. No border, no hard boundary: the fill ramps its alpha down toward
the edges and a radial mask feathers the corners, so the panel melts into the
dark glow background. Heavier backdrop blur deepens the frosted transition. Use
this for chart/overview panels where you want the content to float; keep the
classic card for dense tables that need a contained edge.

```
/* fill fades out toward the perimeter — no solid panel color */
background: radial-gradient(120% 130% at 50% 0%,
              rgba(13,17,25,0.34) 0%,
              rgba(13,17,25,0.22) 45%,
              rgba(13,17,25,0.06) 80%,
              transparent 100%);
backdropFilter: blur(44px) saturate(1.15);
borderRadius: 28px;
border: none;
boxShadow: 0 40px 100px -40px rgba(0,0,0,0.45);   /* feathered glow, not a crisp shadow */
/* mask feathers the card edge into the background */
maskImage: radial-gradient(130% 140% at 50% 40%, #000 60%, transparent 100%);
```

Stat / metric tiles are the same idea at a smaller scale: no border,
`blur(20px)`, and a faint light-blue radial over `rgba(13,17,25,0.20)`. The
metric value keeps its semantic color (green / soft-red / light-blue); the tile
body carries only the highlight.

Layout note: on `/gex2` the two chart panels sit side by side in a
`flex-wrap` row (`flex: 1 1 380px; min-width: 320px`) so they collapse to a
single column on narrow viewports.

## Controls

- **`field()`** — inputs: `rgba(0,0,0,0.30)` fill, 10px radius, hairline border,
  `colorScheme: dark`, `accentColor: cyan`.
- **`primary()`** — cyan gradient button, uppercase, 900 weight.
- **`ghost()`** — transparent button with hairline border.
- **`pill(active)`** — tab pill; active = cyan tint + cyan text, inactive =
  faint white fill.
- **`labelCap()`** — 10px, 800 weight, uppercase, 0.14em tracking, muted. The
  standard small section/field label.

## AUTO chip (recurring rows)

A subtle filled pill, not an outline:

```
background: rgba(126,211,252,0.12);
color: #7dd3fc;
borderRadius: 999px;
padding: 2px 6px;
fontSize: 8px; fontWeight: 800; letterSpacing: 0.08em;
```

## Sticky headers

Any `position: sticky` table/tfoot header uses the **opaque** `HOME_THEME.panel`
(`#0D1119`), never the translucent `panelBgStrong` — otherwise scrolled rows
bleed through the header.

## Cashflow calendar

Month grid of day cells. Each cell is tinted by its net for the day:

- deficit → `rgba(244,148,142,0.10)` (soft red)
- surplus → `rgba(142,202,230,0.08)` (green)
- neutral → `rgba(255,255,255,0.02)`

Selected day: `1px solid #7dd3fc` border + `0 0 0 1px rgba(126,211,252,0.4)`
ring. The net label inside the cell is soft-red / green / muted to match.

## Day blocks (monthly register)

Each day is a rounded block (`12px`, hairline border) with a header strip
(`rgba(255,255,255,0.04)`) showing the date, daily net, and EOD balance. Rows
below carry the single running balance in the right column. The calendar-selected
day gets the light-blue border + ring and scrolls into view.

## Rules of thumb

1. One accent only — light blue `#7dd3fc`. No rotating card colors, no top bars.
2. Reds are always `SOFT_RED` on this page, never `#EF4444`.
3. Sticky surfaces are opaque; frosted translucency is for non-sticky cards.
4. Money is green for income, soft-red for spend/deficit, white/muted for neutral.
5. Source every color from a token or the two named constants — no ad-hoc hex.
6. Prefer the **dissolve card** (borderless, edge-feathered, `blur(44px)`) for
   chart/overview panels; reserve the classic bordered card for dense tables.
