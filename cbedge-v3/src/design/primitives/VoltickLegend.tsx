// ─────────────────────────────────────────────────────────────────────────────
// VOLTICK LEGEND — what the colours mean, in the toolbar.
//
// Voltick theme only. The Options Chain page and the Multi Greek card fill a
// level cell in its reserved colour (data/voltickLevels.ts) with no tag in it,
// so the toolbar carries the key: the four level chips, drawn exactly as the
// cells are (the level's fill with its own ink), plus — where the heat is the
// rest of the grid — the +GEX / −GEX tint pair.
//
// +GEX heat and the Surge fill share a hue on this theme; the swatches are a
// TINT ramp and the chip is SOLID, which is the difference the grid shows too.
// ─────────────────────────────────────────────────────────────────────────────

import { alpha, GEX_NEG, GEX_POS } from '@/design/theme'
import { VT_LEVELS } from '@/data/voltickLevels'

function HeatSwatch({ color, label, title }: { color: string; label: string; title: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap text-3xs font-semibold text-muted">
      <span
        className="inline-block h-2.5 w-[18px] rounded-sm"
        style={{ background: `linear-gradient(90deg, ${alpha(color, 0.15)}, ${alpha(color, 0.55)})` }}
      />
      {label}
    </span>
  )
}

export function VoltickLegend({ heat = false }: { heat?: boolean }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Voltick colour key">
      {VT_LEVELS.map((d) => (
        <span
          key={d.key}
          title={d.title}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-px text-3xs font-extrabold leading-[1.4] tracking-[0.05em]"
          style={{ background: d.fill, color: d.ink }}
        >
          {d.mark} {d.label}
        </span>
      ))}
      {heat && (
        <>
          <span className="h-4 w-px bg-line" aria-hidden />
          <HeatSwatch
            color={GEX_POS}
            label="+GEX"
            title="Positive gamma (tinted cell): dealers dampen moves. Stronger tint = bigger share of the column."
          />
          <HeatSwatch
            color={GEX_NEG}
            label="−GEX"
            title="Negative gamma (tinted cell): dealers amplify moves. Stronger tint = bigger share of the column."
          />
        </>
      )}
    </div>
  )
}
