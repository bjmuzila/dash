// ─────────────────────────────────────────────────────────────────────────────
// COMMUNITY INDICATORS: open-source Pine scripts listed under All in the
// Indicators dialog (indicatorPicker.ts). Added by Brandon, 2026-10-07.
//
// community/everget/ holds Alex Orekhov's collection,
// github.com/everget/tradingview-pinescript-indicators (commit 0b164e1, 2026-10-03),
// under GPL-3.0 (its LICENSE is beside the files). The files are copied as
// published, Pine v3, v4 and v6 alike, and never edited to suit CB Script. If
// one fails to run, the fix belongs in the engine (lang.ts / runtime.ts).
// Three files are left out because they duplicate another file in the set:
//   · oscillators/rsx.pine has the same code as oscillators/jurik_rsx.pine
//   · movings/distance_coefficient_filter.pine has the same code as
//     movings/ehlers_distance_coefficient_filter.pine
//   · movings/recursive_median_oscillator.pine is an older v3 copy of
//     movings/recursive_median_filter.pine, saved under the wrong name
// To refresh: copy the repo's folders over community/everget/ and drop those three.
//
// This is a DATA module. indicatorPicker.ts imports it the first time the
// dialog opens, and vite.config.ts gives it (with the .pine files) its own
// `data-vela-community` chunk, so the /vela page carries none of it until
// then. Each script keeps its own colours, because those are what it draws
// with, the same as a pasted script. The .pine files are not .ts, so
// check-theme does not read them.
// ─────────────────────────────────────────────────────────────────────────────

export interface CommunityIndicator {
  /** Stable, because chart instance ids (`cbs-<id>-<n>`) and the Personal lists key on it. */
  id: string
  /** The script's own title: study("…") / indicator("…"). */
  name: string
  /** The collection's folder, in words: "Oscillator", "Moving average", … */
  group: string
  author: string
  overlay: boolean
  source: string
}

const EVERGET = import.meta.glob<string>('./community/everget/**/*.pine', { query: '?raw', import: 'default', eager: true })

const GROUPS: Record<string, string> = {
  bands_and_channels: 'Bands & channels',
  highlighters: 'Highlighter',
  movings: 'Moving average',
  oscillators: 'Oscillator',
  research: 'Research',
  statistics: 'Statistics',
  trailing_stops: 'Trailing stop',
  utils: 'Utility',
  volatility: 'Volatility',
  volume: 'Volume',
}

const TITLE = /^[ \t]*(?:study|indicator)\s*\(\s*(?:title\s*=\s*)?(["'])(.*?)\1/m
const OVERLAY = /^[ \t]*(?:study|indicator)\s*\([^\n]*\boverlay\s*=\s*true/m

export const COMMUNITY_INDICATORS: CommunityIndicator[] = Object.entries(EVERGET).flatMap(([path, source]) => {
  const at = /\/everget\/([a-z_]+)\/([a-z0-9_]+)\.pine$/.exec(path)
  const folder = at?.[1]
  const file = at?.[2]
  const name = TITLE.exec(source)?.[2]
  if (!folder || !file || !name) return []
  return [
    {
      // the folder too: parabolic_sar.pine is in both movings/ and trailing_stops/
      id: `ev-${folder}-${file}`.replace(/_/g, '-'),
      name,
      group: GROUPS[folder] ?? folder,
      author: 'everget',
      overlay: OVERLAY.test(source),
      source,
    },
  ]
})
