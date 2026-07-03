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

Stat cards use the same treatment; the metric value keeps its semantic color
(green/soft-red/light-blue) while the card body carries only the light-blue
highlight.

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
