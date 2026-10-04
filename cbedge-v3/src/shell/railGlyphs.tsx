// ─────────────────────────────────────────────────────────────────────────────
// The rail's icon set — one stroke family (24-grid, 1.7px, round caps), drawn
// inline so it inherits `currentColor` and needs no icon library in the ENTRY
// chunk. Replaced the emoji glyphs on 2026-10-03: emoji render differently on
// every OS and cannot follow the theme's ink.
//
// Add a glyph = one entry in PATHS and one name in RailGlyph.
// ─────────────────────────────────────────────────────────────────────────────

export type RailGlyph =
  | 'home'
  | 'dash'
  | 'sun'
  | 'whale'
  | 'chain'
  | 'moves'
  | 'cal'
  | 'chart'
  | 'replay'
  | 'radar'
  | 'log'
  | 'book'
  | 'vela'
  | 'flow'
  | 'arch'
  | 'search'

const PATHS: Record<RailGlyph, string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M10 21v-6h4v6'],
  dash: [
    'M4.5 3h4a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 8.5 12h-4A1.5 1.5 0 0 1 3 10.5v-6A1.5 1.5 0 0 1 4.5 3z',
    'M15.5 3h4A1.5 1.5 0 0 1 21 4.5v2A1.5 1.5 0 0 1 19.5 8h-4A1.5 1.5 0 0 1 14 6.5v-2A1.5 1.5 0 0 1 15.5 3z',
    'M15.5 12h4a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5z',
    'M4.5 16h4a1.5 1.5 0 0 1 1.5 1.5v2A1.5 1.5 0 0 1 8.5 21h-4A1.5 1.5 0 0 1 3 19.5v-2A1.5 1.5 0 0 1 4.5 16z',
  ],
  sun: ['M12 3v4', 'm5 10 1.5 1.5', 'M2 18h2M20 18h2', 'm19 10-1.5 1.5', 'M22 21H2', 'M16 18a4 4 0 0 0-8 0'],
  whale: [
    'M2 7c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2',
    'M2 13c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2',
    'M2 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2',
  ],
  chain: ['m12 2 9 5-9 5-9-5 9-5z', 'm3 12 9 5 9-5', 'm3 17 9 5 9-5'],
  moves: ['M8 3 4 7l4 4', 'M4 7h16', 'm16 21 4-4-4-4', 'M20 17H4'],
  cal: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M16 2v4M8 2v4M3 10h18'],
  chart: ['M3 3v18h18', 'm7 15 4-4 3 3 5-6'],
  replay: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'm10 9 5 3-5 3z'],
  radar: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
    'm12 12 6-6',
  ],
  log: ['M4 6h16M4 12h10M4 18h16', 'M18 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z', 'M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5'],
  vela: ['M12 2v15', 'M11 3 4 15h7z', 'M13 6l6 9h-6z', 'M3 18h18l-2 3H5z'],
  flow: ['M3 12h4l3-8 4 16 3-8h4'],
  arch: ['M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M10 12h4'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20 20-3.5-3.5'],
}

export function RailIcon({ name, className }: { name: RailGlyph; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
