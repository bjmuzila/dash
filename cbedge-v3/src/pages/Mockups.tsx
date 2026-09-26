import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Page } from '@/design/primitives/Page'
import { T, alpha, VIOLET } from '@/design/theme'
import { useAuth } from '@/data/auth'
import { NAV } from '@/shell/Shell'

// ─────────────────────────────────────────────────────────────────────────────
// MOCKUPS — the owner's design board (2026-09-25).
//
// Static pictures of the busiest Voltick surfaces, laid flat so their
// organisation and flow can be argued about without opening five menus on a
// live page. Four tabs:
//
//   1. Chart ⚙ Style   the chart toolbar + its Style / Indicators / Draw popover
//   2. Flow toolbars    every tab row, sub-row, chip, dropdown and panel on Flow
//   3. Account menu     the rail's bottom-left account pop-up
//   4. Settings (new)   a proposed Settings page that hides pages from the left
//                       rail, with a live preview of the rail (v3's or Voltick's)
//
// NOTHING HERE IS WIRED. No fetch, no socket, no localStorage — every control
// holds its own React state and forgets it on reload. Labels are copied from
// the live surfaces, so this page is a snapshot, not a second implementation.
//
// Owner only: `isOwner` decides what is DRAWN (data/auth.tsx). The page holds
// no data, so there is nothing behind it to gate server-side.
//
// Tokens only (non-negotiable 1): Tailwind utilities for the ladder, T.* and
// alpha() for the few colours a class cannot carry, type sizes off the scale.
// ─────────────────────────────────────────────────────────────────────────────

const VT = {
  volt: 'var(--color-vt-volt)',
  good: 'var(--color-vt-good)',
  bad: 'var(--color-vt-bad)',
  dark: VIOLET,
}

type Opt<K extends string> = readonly (readonly [K, string])[]

function Seg<K extends string>({ options, value, onChange }: { options: Opt<K>; value: K; onChange?: (k: K) => void }) {
  return (
    <span className="inline-flex flex-wrap overflow-hidden rounded-md border border-line">
      {options.map(([k, lbl], i) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange?.(k)}
          className={[
            'px-2.5 py-1 text-xs font-bold transition-colors',
            i ? 'border-l border-line' : '',
            value === k ? 'text-accent' : 'text-fg hover:bg-raised',
          ].join(' ')}
          style={value === k ? { background: alpha(T.cyan, 0.2) } : undefined}
        >
          {lbl}
        </button>
      ))}
    </span>
  )
}

function OnOff({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'shrink-0 rounded-md border px-2.5 py-1 text-xs font-bold',
        on ? 'border-accent text-accent' : 'border-line text-fg',
      ].join(' ')}
      style={on ? { background: alpha(T.cyan, 0.2) } : undefined}
    >
      {on ? '✓ On' : 'Off'}
    </button>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
      style={{ background: on ? T.cyan : alpha(T.text, 0.18) }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-fg transition-all"
        style={{ left: on ? 18 : 2 }}
      />
    </button>
  )
}

function Pill({
  children,
  on,
  tone = T.cyan,
  onClick,
  className = '',
}: {
  children: ReactNode
  on?: boolean
  tone?: string
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-md border bg-raised px-2.5 py-1.5 text-xs font-bold text-fg ${className}`}
      style={
        on
          ? { borderColor: tone, background: alpha(tone, 0.16), boxShadow: `inset 0 -1px 0 ${tone}` }
          : { borderColor: T.border }
      }
    >
      {children}
    </button>
  )
}

function SecHead({ children }: { children: ReactNode }) {
  return (
    <div className="mb-0.5 mt-4 flex items-center gap-2 font-mono text-3xs font-extrabold uppercase tracking-widest text-muted">
      {children}
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  )
}

function Row({ label, children, indent = false }: { label: string; children?: ReactNode; indent?: boolean }) {
  return (
    <div className={`my-2 flex items-center justify-between gap-2.5 ${indent ? 'ml-3' : ''}`}>
      <span className="whitespace-nowrap text-sm font-bold text-fg">{label}</span>
      {children}
    </div>
  )
}

function Slider({
  label,
  value,
  onChange,
  color,
  min = 0,
  max = 100,
  suffix = '%',
}: {
  label: string
  value: number
  onChange: (n: number) => void
  color: string
  min?: number
  max?: number
  suffix?: string
}) {
  return (
    <Row label={label}>
      <span className="inline-flex items-center gap-2.5">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(+e.target.value)}
          className="w-28 cursor-pointer"
          style={{ accentColor: color }}
        />
        <span className="w-8 text-right font-mono text-xs font-bold text-fg">
          {value}
          {suffix}
        </span>
      </span>
    </Row>
  )
}

function Pop({ children, className = 'w-[348px]' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`max-w-full rounded-lg border border-line bg-surface px-3.5 py-3 ${className}`}
      style={{ boxShadow: `0 14px 40px ${alpha('var(--color-shadow)', 0.5)}` }}
    >
      {children}
    </div>
  )
}

function Frame({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-1.5 font-mono text-2xs font-extrabold uppercase tracking-widest text-accent">{title}</div>
      {note && <p className="mb-2 max-w-xl text-xs leading-relaxed text-muted">{note}</p>}
      {children}
    </section>
  )
}

function Menu({ items, value, className = 'w-44' }: { items: string[]; value?: string; className?: string }) {
  return (
    <div className={`grid gap-px rounded-md border border-line bg-surface p-1 ${className}`}>
      {items.map((it) => (
        <div
          key={it}
          className="rounded px-2.5 py-1.5 text-sm font-semibold text-fg"
          style={it === value ? { background: alpha(T.cyan, 0.18) } : undefined}
        >
          {it}
        </div>
      ))}
    </div>
  )
}

function Box({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`rounded-lg border border-line bg-surface2 px-4 py-3.5 ${className}`} style={style}>
      {children}
    </div>
  )
}

function Notes({ items }: { items: ReactNode[] }) {
  return (
    <Frame title="Organisation notes">
      <Box>
        <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-fg">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      </Box>
    </Frame>
  )
}

const Bar = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2.5">{children}</div>
)

const Field = ({ ph, w = 'w-36' }: { ph: string; w?: string }) => (
  <span className={`${w} rounded-md border border-line bg-surface2 px-2.5 py-1.5 text-xs text-muted`}>{ph}</span>
)

const Heads = ({ cols }: { cols: string[] }) => (
  <div className="flex flex-wrap overflow-hidden rounded-md border border-line bg-surface2">
    {cols.map((c, i) => (
      <span key={c} className={`whitespace-nowrap px-2.5 py-2 text-xs font-bold text-muted ${i ? 'border-l border-line' : ''}`}>
        {c}
      </span>
    ))}
  </div>
)

const Label = ({ children }: { children: ReactNode }) => (
  <div className="mb-1.5 font-mono text-2xs text-muted">{children}</div>
)

// ═════════════════════════════════════════════════════════════════════════════
// 1 · CHART ⚙ STYLE
// ═════════════════════════════════════════════════════════════════════════════

// The button above these says "Fine tune the six" and there are EIGHT rows.
const CALM_ROWS = [
  'No volume bars',
  'Rail tags on one line',
  'Ribbons fade toward history',
  'Ribbons grow and shrink with the level',
  'Session ranges as hairlines',
  'Session captions at the foot',
  'Volume in its own strip',
  'Watermark in the corner',
]

const IND_ROWS: { name: string; color: string; desc: string; params?: string[] }[] = [
  { name: 'VWAP', color: T.text, desc: "Volume-weighted average price · the day's true VWAP." },
  { name: 'VWAP bands', color: T.muted, desc: 'Standard-deviation bands around the session VWAP.', params: ['2σ', '2.5σ'] },
  { name: 'RSI', color: T.cyan, desc: 'A 0–100 momentum meter in its own strip. Near 70 = hot, near 30 = cold.', params: ['14'] },
  { name: 'MACD', color: T.cyan, desc: 'Momentum from the gap between a fast and slow EMA, in its own strip.', params: ['12', '26', '9'] },
  { name: 'Williams %R', color: VT.volt, desc: 'A 0 to −100 momentum meter in its own strip.', params: ['14'] },
]

function StyleTabBody() {
  const [trails, setTrails] = useState(true)
  const [shape, setShape] = useState<'core' | 'profile' | 'ribbon' | 'path' | 'pathband'>('path')
  const [bubbles, setBubbles] = useState<'all' | 'key'>('key')
  const [density, setDensity] = useState<'full' | 'calm' | 'minimal'>('full')
  const [fine, setFine] = useState(false)
  const [calm, setCalm] = useState<boolean[]>(() => CALM_ROWS.map(() => false))
  const [g, setG] = useState(24)
  const [n, setN] = useState(43)
  const [dp, setDp] = useState(0)
  const [shown, setShown] = useState(6)
  const [keyOnly, setKeyOnly] = useState(false)
  const [len, setLen] = useState<'ext' | 'small' | 'label'>('ext')
  const [prior, setPrior] = useState(true)
  const [priorN, setPriorN] = useState<'1' | '3' | '5'>('3')
  const [prev, setPrev] = useState(true)
  const [pre, setPre] = useState(false)
  const [orng, setOrng] = useState(false)
  const [over, setOver] = useState<'5' | '15' | '30'>('15')
  const [ext, setExt] = useState(true)
  const [wm, setWm] = useState(true)
  return (
    <>
      <div className="mb-1.5 font-mono text-3xs font-extrabold tracking-widest text-muted">YOUR DEVICE REMEMBERS</div>
      <SecHead>Level trails</SecHead>
      <Row label="Level trails">
        <OnOff on={trails} onClick={() => setTrails(!trails)} />
      </Row>
      {trails && (
        <>
          <div className="my-2 ml-3 grid gap-1.5">
            <span className="text-xs font-bold text-fg">Trail shape</span>
            <Seg
              value={shape}
              onChange={setShape}
              options={[['core', 'Core'], ['profile', 'Profile'], ['ribbon', 'Ribbon'], ['path', 'Path'], ['pathband', 'Path Ribbon']] as const}
            />
          </div>
          <Row label="Bubble rows" indent>
            <Seg value={bubbles} onChange={setBubbles} options={[['all', 'All'], ['key', 'Key only']] as const} />
          </Row>
          <p className="mb-1 ml-3 text-xs leading-relaxed text-fg">
            Thicker where a level grew, thinner where it shrank. Brighter means a bigger day. Recorded history, not a forecast.
          </p>
        </>
      )}
      <SecHead>Density</SecHead>
      <Row label="Density">
        <Seg
          value={density}
          onChange={(v) => {
            setDensity(v)
            setFine(false)
          }}
          options={[['full', 'Full'], ['calm', 'Calm'], ['minimal', 'Minimal']] as const}
        />
      </Row>
      <button
        type="button"
        onClick={() => setFine(!fine)}
        className="w-full rounded-md border border-dashed border-line px-2.5 py-2 text-xs font-semibold text-muted"
      >
        Fine tune the six {fine ? '▴' : '▾'}
      </button>
      {fine &&
        CALM_ROWS.map((lbl, i) => (
          <Row key={lbl} label={lbl} indent>
            <OnOff on={!!calm[i]} onClick={() => setCalm(calm.map((v, j) => (j === i ? !v : v)))} />
          </Row>
        ))}
      <SecHead>How bold</SecHead>
      <Slider label="Gamma levels" value={g} onChange={setG} color={T.cyan} />
      <Slider label="Node levels" value={n} onChange={setN} color={VT.volt} />
      <Slider label="Dark pool" value={dp} onChange={setDp} color={VT.dark} />
      <SecHead>Which lines</SecHead>
      <Slider label="Levels shown" value={shown} onChange={setShown} color={VT.good} min={4} max={14} suffix="" />
      <Row label="Key levels only">
        <OnOff on={keyOnly} onClick={() => setKeyOnly(!keyOnly)} />
      </Row>
      <Row label="Line length">
        <Seg value={len} onChange={setLen} options={[['ext', 'Extended'], ['small', 'Small'], ['label', 'Labels']] as const} />
      </Row>
      <Row label="Prior levels">
        <span className="inline-flex items-center gap-1.5">
          {prior && <Seg value={priorN} onChange={setPriorN} options={[['1', '1'], ['3', '3'], ['5', '5']] as const} />}
          <OnOff on={prior} onClick={() => setPrior(!prior)} />
        </span>
      </Row>
      {prior && (
        <p className="mb-1 text-xs leading-relaxed text-fg">
          <b style={{ color: VT.volt }}>--- ★</b> prior Volt · <b style={{ color: VT.good }}>--- ‖</b> prior ceiling ·{' '}
          <b style={{ color: VT.bad }}>--- ‖</b> prior floor · faded by age.
        </p>
      )}
      <SecHead>Session ranges</SecHead>
      <Row label="Previous day">
        <OnOff on={prev} onClick={() => setPrev(!prev)} />
      </Row>
      <Row label="Pre-market">
        <OnOff on={pre} onClick={() => setPre(!pre)} />
      </Row>
      <Row label="Opening range">
        <OnOff on={orng} onClick={() => setOrng(!orng)} />
      </Row>
      {orng && (
        <Row label="Measured over" indent>
          <Seg value={over} onChange={setOver} options={[['5', '5m'], ['15', '15m'], ['30', '30m']] as const} />
        </Row>
      )}
      <Row label="Extended hours">
        <OnOff on={ext} onClick={() => setExt(!ext)} />
      </Row>
      <SecHead>Watermark</SecHead>
      <Row label="Watermark">
        <OnOff on={wm} onClick={() => setWm(!wm)} />
      </Row>
    </>
  )
}

interface MaLine {
  id: number
  p: number
  on: boolean
}

function IndicatorsTabBody() {
  const [ma, setMa] = useState<Record<'emas' | 'smas', MaLine[]>>({
    emas: [
      { id: 1, p: 9, on: true },
      { id: 2, p: 21, on: false },
    ],
    smas: [],
  })
  const [on, setOn] = useState<Record<string, boolean>>({ VWAP: true })
  const add = (k: 'emas' | 'smas') => setMa({ ...ma, [k]: [...ma[k], { id: Date.now(), p: k === 'emas' ? 9 : 20, on: true }] })
  return (
    <>
      {(
        [
          ['emas', 'EMA · exponential', T.cyan],
          ['smas', 'SMA · simple', VT.volt],
        ] as const
      ).map(([k, title, color]) => (
        <div key={k}>
          <div className="flex items-center justify-between px-1.5 pb-1 pt-1.5">
            <span className="font-mono text-2xs font-extrabold tracking-wider text-fg">{title}</span>
            <button type="button" onClick={() => add(k)} className="rounded-md border border-line px-2.5 py-0.5 text-xs font-bold text-fg">
              ＋ Add
            </button>
          </div>
          {!ma[k].length && <div className="px-2 pb-2 pt-0.5 text-xs text-fg">None yet · tap Add</div>}
          {ma[k].map((x) => (
            <div key={x.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={x.on ? { background: alpha(color, 0.08) } : undefined}>
              <Toggle on={x.on} onClick={() => setMa({ ...ma, [k]: ma[k].map((y) => (y.id === x.id ? { ...y, on: !y.on } : y)) })} />
              <span className="h-[3px] w-3 rounded-sm" style={{ background: color }} />
              <span className="w-8 text-sm font-bold text-fg">{k === 'emas' ? 'EMA' : 'SMA'}</span>
              <span className="w-11 rounded-md border border-line bg-surface2 py-0.5 text-center font-mono text-sm font-bold text-fg">{x.p}</span>
              <span className="h-6 w-7 rounded-md border border-line" style={{ background: color }} />
              <button
                type="button"
                onClick={() => setMa({ ...ma, [k]: ma[k].filter((y) => y.id !== x.id) })}
                className="ml-auto h-6 w-6 rounded-md border border-line font-bold text-fg"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ))}
      <div className="mx-1 my-2 h-px bg-line" />
      {IND_ROWS.map(({ name, color, desc, params }) => (
        <div key={name} className="flex items-start gap-2.5 rounded-lg px-2 py-2" style={on[name] ? { background: alpha(color, 0.08) } : undefined}>
          <Toggle on={!!on[name]} onClick={() => setOn({ ...on, [name]: !on[name] })} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="h-[3px] w-3 rounded-sm" style={{ background: color }} />
              <span className="text-sm font-bold text-fg">{name}</span>
              <span className="ml-auto flex gap-1">
                {(params || []).map((p) => (
                  <span key={p} className="rounded-md border border-line bg-surface2 px-1.5 py-0.5 font-mono text-xs font-bold text-fg">
                    {p}
                  </span>
                ))}
              </span>
            </div>
            <div className="mt-1 text-xs leading-snug text-fg">{desc}</div>
          </div>
        </div>
      ))}
    </>
  )
}

function DrawTabBody() {
  const [drawing, setDrawing] = useState(false)
  const [lines, setLines] = useState(2)
  const btn = 'flex-1 rounded-lg border border-line px-3 py-1.5 text-sm font-bold text-fg'
  return (
    <div className="grid gap-3">
      <div>
        <div className="mb-1.5 font-mono text-3xs font-extrabold tracking-widest text-muted">COLOUR</div>
        <div className="h-7 rounded-md border border-line" style={{ background: VT.volt }} />
      </div>
      <button
        type="button"
        onClick={() => setDrawing(!drawing)}
        className={`rounded-lg border px-3 py-2 text-sm font-bold ${drawing ? 'border-accent text-accent' : 'border-line text-fg'}`}
        style={drawing ? { background: alpha(T.cyan, 0.18) } : undefined}
      >
        ✎ {drawing ? 'Drawing · tap to stop' : 'Start drawing'}
      </button>
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={() => setLines(Math.max(0, lines - 1))}>
          ⤺ Undo
        </button>
        <button type="button" className={btn} onClick={() => setLines(0)}>
          Clear
        </button>
      </div>
      <div className="text-xs leading-relaxed text-muted">
        {lines ? `${lines} line${lines === 1 ? '' : 's'} on this symbol · they follow the browser, not the account.` : 'Nothing drawn on this symbol yet.'}
      </div>
    </div>
  )
}

function StylePopover({ start }: { start: 'style' | 'ind' | 'draw' }) {
  const [tab, setTab] = useState(start)
  return (
    <Pop>
      <div className="mb-2">
        <Seg value={tab} onChange={setTab} options={[['style', 'Style'], ['ind', 'Indicators'], ['draw', 'Draw']] as const} />
      </div>
      {tab === 'style' ? <StyleTabBody /> : tab === 'ind' ? <IndicatorsTabBody /> : <DrawTabBody />}
    </Pop>
  )
}

function ChartTab() {
  const [fwd, setFwd] = useState(false)
  return (
    <div className="grid gap-6">
      <Frame title="The chart toolbar" note="The four controls above the candles. Forward off ▾ opens its dropdown here; ⚙ Style opens the popover below.">
        <div className="flex flex-wrap items-start gap-4">
          <Bar>
            <Pill on>⚙ Style</Pill>
            <Pill on={fwd} onClick={() => setFwd(!fwd)}>
              Forward off ▾
            </Pill>
            <Pill on>
              <span className="text-accent">●</span> Trails
            </Pill>
            <Pill>⛶ Full screen</Pill>
          </Bar>
          {fwd && <Menu value="Forward off" items={['Forward off', 'Forward · today', 'Forward · week']} />}
        </div>
      </Frame>
      <Frame
        title="⚙ Style popover · all three tabs, open side by side"
        note="Each column is the same 348px popover opened on a different tab. Every control works locally so the flow can be clicked through · nothing is saved."
      >
        <div className="flex flex-wrap items-start gap-4">
          <StylePopover start="style" />
          <StylePopover start="ind" />
          <StylePopover start="draw" />
        </div>
      </Frame>
      <Notes
        items={[
          'Style tab holds 6 sections and ~22 controls: Level trails · Density · How bold · Which lines · Session ranges · Watermark.',
          <>
            “Fine tune the six” opens <b>{CALM_ROWS.length}</b> switches · the label and the count disagree.
          </>,
          '“Trails” has its own toolbar button AND leads the Style tab · two doors to one switch.',
          '“YOUR DEVICE REMEMBERS” shows on Style only; Draw follows the browser per symbol.',
        ]}
      />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// 2 · FLOW TOOLBARS
// ═════════════════════════════════════════════════════════════════════════════

type FlowView =
  | 'options' | 'repeats' | 'oneshots' | 'roster' | 'quiet' | 'oi' | 'leaders'
  | 'sectors' | 'drift' | 'premium' | 'dark' | 'cross'

const FLOW_GROUPS: { key: string; label: string; views: [FlowView, string][] }[] = [
  {
    key: 'tape',
    label: '⚡︎ The Tape',
    views: [
      ['options', '⚡︎ Options Flow'],
      ['repeats', '⟳ Repeated'],
      ['oneshots', '▮ One-Shots'],
      ['roster', '▲ Being Built'],
      ['quiet', '⌁ Waking Up'],
    ],
  },
  { key: 'oi', label: 'Δ OI Changes', views: [['oi', 'Δ OI Changes']] },
  { key: 'market', label: '◉ Most Active', views: [['leaders', 'Leaders']] },
  { key: 'sectors', label: '▤ Sector Flow', views: [['sectors', 'Sector Flow']] },
  { key: 'drift', label: '✦ Net Drift', views: [['drift', 'Net Drift']] },
  { key: 'premium', label: '$ Premium', views: [['premium', 'Premium by Expiry']] },
  {
    key: 'dark',
    label: '◐ Dark Pool',
    views: [
      ['dark', '◐ Dark Pool Flow'],
      ['cross', '⧖ Cross-Confirm'],
    ],
  },
]

const DD = ({ children, on, onClick }: { children: ReactNode; on?: boolean; onClick?: () => void }) => (
  <Pill on={on} onClick={onClick}>
    {children} ▾
  </Pill>
)

const DAYS = ['0DTE', '1 to 30', '31 to 90', '90+']

function StatsStrip() {
  const [sort, setSort] = useState<'new' | 'big'>('new')
  const [paused, setPaused] = useState(false)
  const cell = 'min-w-[120px] border-l border-line px-3.5 py-2.5'
  const lab = 'mb-1 text-xs text-muted'
  const big = 'font-mono text-xl font-extrabold'
  return (
    <div className="flex flex-wrap items-stretch overflow-hidden rounded-lg border border-line bg-surface">
      <div className="min-w-[120px] px-3.5 py-2.5">
        <div className={lab}>
          Net premium{' '}
          <span className="ml-1 rounded-full border px-1.5" style={{ color: VT.good, borderColor: alpha(VT.good, 0.4) }}>
            ▲ Bought
          </span>
        </div>
        <div className={big} style={{ color: VT.good }}>+$17.7M</div>
        <div className={`${lab} mt-1`}>of $331M with a clear buyer or seller</div>
      </div>
      <div className={cell}>
        <div className={lab}>Prints</div>
        <div className={`${big} text-fg`}>14,789</div>
        <div className={`${lab} mt-1`}>
          Swept · in a hurry <b className="text-accent">7%</b>
        </div>
      </div>
      <div className={cell}>
        <div className={lab}>Call $ · Put $</div>
        <span className={big} style={{ color: VT.good }}>$692M</span>{' '}
        <span className={big} style={{ color: VT.bad }}>$200M</span>
      </div>
      <div className={cell}>
        <div className={lab}>Buys · Sells</div>
        <span className={big} style={{ color: VT.good }}>$174M</span>{' '}
        <span className={big} style={{ color: VT.bad }}>$157M</span>
        <div className={`${lab} mt-1`}>Put / call 0.41 · two-sided · neither in control</div>
      </div>
      <div className={`${cell} flex items-center gap-2`}>
        <Seg value={sort} onChange={setSort} options={[['new', '⏱ Newest'], ['big', '＄ Biggest']] as const} />
        <Pill on={paused} tone={VT.volt} onClick={() => setPaused(!paused)}>
          {paused ? '▶ Resume' : '❚❚ Pause'}
        </Pill>
      </div>
    </div>
  )
}

const FILTER_ROWS: [string, string[]][] = [
  ['Presets', ['Whales $250K+', 'Big LEAPs $500K+']],
  ['Direction', ['Both', 'Bullish', 'Bearish']],
  ['Type', ['Calls', 'Puts']],
  ['Fill', ['Buys', 'Sells']],
  ['Size', ['$50K+', '$250K+', '$500K+', '$1M+']],
  ['OI under', ['500', '1K', '2.5K']],
  ['Volume over', ['500', '1K', '2K', '5K']],
  ['Vol/OI over', ['1x', '2x', '3x', '5x', '10x']],
  ['Days out', DAYS],
  ['Expiry', ['Any date ▾']],
  ['Contract price', ['Any price ▾']],
]

function FiltersPanel() {
  const [sel, setSel] = useState<Record<string, string | null>>({ Direction: 'Both' })
  return (
    <Box className="grid gap-2">
      {FILTER_ROWS.map(([k, opts]) => (
        <div key={k} className="flex flex-wrap items-center gap-2">
          <span className="w-28 font-mono text-2xs font-extrabold uppercase tracking-wider text-muted">{k}</span>
          {opts.map((o) => (
            <Pill key={o} on={sel[k] === o} onClick={() => setSel({ ...sel, [k]: sel[k] === o ? null : o })} className="py-1">
              {o}
            </Pill>
          ))}
        </div>
      ))}
    </Box>
  )
}

function PresetsPop() {
  return (
    <Pop className="w-[340px]">
      <div className="mb-2 font-mono text-3xs font-extrabold tracking-widest text-muted">PRESETS · OPTIONS TAPE</div>
      {[
        ['Whales', '$250K+ · at ask · bullish'],
        ['Morning sweep', '$500K+ · 0DTE'],
      ].map(([nm, s]) => (
        <div key={nm} className="mb-1 flex items-center gap-2 rounded-md bg-surface2 px-2 py-1.5">
          <div className="min-w-0">
            <div className="text-sm font-bold text-fg">{nm}</div>
            <div className="font-mono text-2xs text-muted">{s}</div>
          </div>
          <span className="ml-auto text-muted">✕</span>
        </div>
      ))}
      <div className="px-2 pb-1 pt-2 text-xs font-bold text-accent">＋ Save the chips that are on now as…</div>
      <div className="px-2 py-1 text-xs text-muted">Clear every filter on this board</div>
    </Pop>
  )
}

function OptionsFlowToolbar() {
  const [on, setOn] = useState<Record<string, boolean>>({})
  const [showFilters, setShowFilters] = useState(false)
  const [open, setOpen] = useState<null | 'names' | 'presets' | 'live'>(null)
  const t = (k: string) => setOn({ ...on, [k]: !on[k] })
  const tog = (k: 'names' | 'presets' | 'live') => setOpen(open === k ? null : k)
  return (
    <div className="grid gap-2.5">
      <StatsStrip />
      <Bar>
        <Field ph="Search ticker…" />
        <DD on={open === 'names'} onClick={() => tog('names')}>
          Stocks
        </DD>
        <span className="h-5 w-px bg-line" />
        <span className="font-mono text-2xs text-muted">SIZE</span>
        {['Mega', 'Large', 'Mid', 'Small'].map((c) => (
          <Pill key={c} on={on[c]} onClick={() => t(c)} className="py-1">
            {c}
          </Pill>
        ))}
        <Pill on={on.up} tone={VT.good} onClick={() => t('up')}>▲</Pill>
        <Pill on={on.dn} tone={VT.bad} onClick={() => t('dn')}>▼</Pill>
        <Pill on={on.unu} tone={VT.volt} onClick={() => t('unu')}>★ Unusual</Pill>
        <Pill on={on.dte} onClick={() => t('dte')}>⚡︎ 0DTE</Pill>
        <Pill on={on.lvl} onClick={() => t('lvl')}>⌖ On a level</Pill>
        <Pill on={on.wl} onClick={() => t('wl')}>★ My watchlist</Pill>
        <Pill on={on.out} onClick={() => t('out')}>⌥ Outright only</Pill>
        <Pill on={showFilters} onClick={() => setShowFilters(!showFilters)}>
          ⚙ Filters {showFilters ? '▴' : '▾'}
        </Pill>
        <DD on={open === 'presets'} onClick={() => tog('presets')}>
          ★ Presets
        </DD>
        <Pill>⟳ Repeated · 1162</Pill>
        <span className="ml-auto flex gap-2">
          <DD on={open === 'live'} onClick={() => tog('live')}>
            <span style={{ color: VT.good }}>●</span> Live
          </DD>
          <Pill>◑ CB</Pill>
        </span>
      </Bar>
      {open === 'names' && <Menu value="Stocks" items={['Stocks', 'ETFs', 'All']} />}
      {open === 'presets' && <PresetsPop />}
      {open === 'live' && <Menu value="● Live" items={['● Live', '↺ 2026-09-24', '↺ 2026-09-23', '↺ 2026-09-22']} />}
      {showFilters && <FiltersPanel />}
      <Bar>
        <span className="text-xs font-bold text-fg">Find a contract</span>
        <Field ph="Strike" w="w-20" />
        <Field ph="YYYY-MM-DD" w="w-28" />
        <Seg value="C" options={[['C', 'C'], ['P', 'P']] as const} />
        <Pill>Open</Pill>
        <span className="text-xs text-muted">type a ticker above first</span>
      </Bar>
      <Heads
        cols={['Time', 'Premium', 'Symbol', 'Spot', 'Strike', 'Type', 'Level', 'Expiring', 'Read', 'Execution', 'Price', 'Size', 'Score', 'Vol/OI', 'Volume', 'Open Int']}
      />
    </div>
  )
}

function TickerRow() {
  return (
    <Bar>
      <Field ph="Ticker" w="w-28" />
      <Seg value="both" options={[['both', 'Both'], ['bull', 'Bullish'], ['bear', 'Bearish']] as const} />
      {DAYS.map((d) => (
        <Pill key={d} className="py-1">{d}</Pill>
      ))}
    </Bar>
  )
}

function ViewToolbar({ view }: { view: FlowView }) {
  const quick = (list: string[]) => list.map((s) => <Pill key={s} className="px-2 py-1">{s}</Pill>)
  const live = (
    <DD>
      <span style={{ color: VT.good }}>●</span> Live
    </DD>
  )
  switch (view) {
    case 'options':
      return <OptionsFlowToolbar />
    case 'repeats':
      return (
        <div className="grid gap-2.5">
          <TickerRow />
          <Bar>
            <DD>★ Presets</DD>
            <DD>⊘ Hide · 3</DD>
            <DD>Stocks</DD>
            <Pill>⊙ Building</Pill>
            <Pill>◑ ITM off</Pill>
            <Pill>↑ Vol &gt; OI</Pill>
            <DD>Any premium</DD>
            <DD>Any price</DD>
            <Pill>⚙ Rolls &amp; financing off</Pill>
            <Pill>⌃ 80% at ask</Pill>
            <Seg value="all" options={[['all', '≡ All contracts'], ['name', '▤ By name']] as const} />
            <Pill>⧉ Copy</Pill>
          </Bar>
          <Heads cols={['Ticker', 'Position', 'Shape', 'Last print', 'Hits', 'Span', 'Vol/OI', 'Premium', 'Size', 'Price']} />
        </div>
      )
    case 'oneshots':
      return (
        <div className="grid gap-2.5">
          <TickerRow />
          <Bar>
            <Pill>⌃ 80% at ask</Pill>
            <Pill>◑ No ITM</Pill>
            <DD>Any premium</DD>
            <DD>Any price</DD>
            <Pill>⏱ Time order</Pill>
            <DD>★ Presets</DD>
          </Bar>
          <Heads cols={['Time', 'Symbol', 'Contract', 'Level', 'Expiring', 'Premium', 'Size', 'Fill', 'Vol/OI', 'Price']} />
        </div>
      )
    case 'roster':
      return (
        <Bar>
          <DD>Stocks</DD>
          <Pill>≥80% at ask</Pill>
          <Seg value="10d" options={[['5d', '5d'], ['10d', '10d'], ['20d', '20d'], ['40d', '40d']] as const} />
        </Bar>
      )
    case 'quiet':
      return (
        <div className="grid gap-2.5">
          <Bar>
            <Pill>⌃ 80% at ask</Pill>
            <Pill>$500K+</Pill>
            <Pill>◑ ITM in</Pill>
            <DD>★ Presets</DD>
            {quick(['0DTE', '1-30d', '31-90d', '90d+'])}
          </Bar>
          <Heads
            cols={['Ticker', 'What kind of loud', 'Who reached', 'Calls / puts', 'Biggest contract', 'Premium today', 'Normal by now', '× on premium', 'Prints', '× on prints', 'Sessions']}
          />
        </div>
      )
    case 'oi':
      return (
        <Box>
          <span className="text-sm text-muted">Δ OI Changes is its own page component · controls to be captured in a follow-up pass.</span>
        </Box>
      )
    case 'leaders':
      return (
        <div className="grid gap-2.5">
          <Bar>
            <span className="text-xs text-muted">Sectors · 11 · tap to filter</span>
            <Pill>All sectors</Pill>
            <Pill>☆ My watchlist 0</Pill>
          </Bar>
          <Heads cols={['Board', 'Sector', 'Price', 'Premium', 'Lean', 'Pace', 'Prints']} />
        </div>
      )
    case 'sectors':
      return (
        <Bar>
          <Seg value="today" options={[['today', 'Today'], ['week', 'Week'], ['month', 'Month']] as const} />
          <span className="font-mono text-2xs text-muted">SORT</span>
          <Seg value="act" options={[['act', 'Activity'], ['net', 'Net'], ['move', '% Move']] as const} />
        </Bar>
      )
    case 'drift':
      return (
        <Bar>
          <Field ph="Ticker" w="w-28" />
          {quick(['SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA', 'AAPL', 'AMZN', 'META', 'MSFT', 'GOOGL', 'AMD', 'PLTR'])}
          {live}
          <DD>Core strikes</DD>
          <Pill>＋ Show Calls &amp; Puts</Pill>
        </Bar>
      )
    case 'premium':
      return (
        <div className="grid gap-2.5">
          <Bar>
            <Field ph="Ticker" w="w-28" />
            {quick(['SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA'])}
            {live}
          </Bar>
          <Heads cols={['Expires', 'DTE', 'Total', 'Size', 'Calls', 'Calls versus puts', 'Puts', 'Call %']} />
        </div>
      )
    case 'dark':
      return (
        <div className="grid gap-2.5">
          <Bar>
            <Seg value="tape" options={[['tick', '◧ By ticker'], ['tape', '⚡︎ Live tape'], ['lead', '★ Leaders']] as const} />
            <Seg value="all" options={[['all', 'All'], ['50', '50K+'], ['100', '100K+'], ['250', '250K+']] as const} />
            <Seg value="time" options={[['time', 'Time'], ['score', '◆ Score']] as const} />
            <Pill>★ Standout</Pill>
            <span className="text-xs" style={{ color: VT.good }}>● live</span>
          </Bar>
          <Heads cols={['Time', 'Stock', 'Price', 'Level', 'Size', 'Notional', 'Score', 'Day Volume', '% of Day', 'Venue', 'Why it scored']} />
        </div>
      )
    case 'cross':
      return (
        <Box>
          <span className="text-sm text-muted">⧖ Cross-Confirm has no controls · a list of cards.</span>
        </Box>
      )
  }
}

function FlowTab() {
  const [group, setGroup] = useState('tape')
  const [view, setView] = useState<FlowView>('options')
  const [mode, setMode] = useState<'one' | 'all'>('one')
  const g = FLOW_GROUPS.find((x) => x.key === group) ?? FLOW_GROUPS[0]!
  const allViews = FLOW_GROUPS.flatMap((grp) =>
    grp.views.map(([vk, vl]) => [vk, grp.views.length > 1 ? `${grp.label} › ${vl}` : grp.label] as const),
  )
  const titleOf = (v: FlowView) => allViews.find(([k]) => k === v)?.[1] ?? v
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm text-muted">Show</span>
        <Seg value={mode} onChange={setMode} options={[['one', 'One view (click through)'], ['all', 'Every view stacked']] as const} />
      </div>
      <Frame title="View tabs + sub-tabs" note="Top row = the view groups. A sub-row appears only when a group holds more than one view (The Tape, Dark Pool).">
        <div className="grid justify-items-center gap-2 rounded-lg border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {FLOW_GROUPS.map((x) => (
              <Pill
                key={x.key}
                on={group === x.key}
                tone={x.key === 'dark' ? VT.dark : T.cyan}
                onClick={() => {
                  setGroup(x.key)
                  setView(x.views[0]![0])
                }}
              >
                {x.label}
              </Pill>
            ))}
            <Pill className="ml-3 border-accent">▶ Show me around</Pill>
          </div>
          {g.views.length > 1 && (
            <div className="flex flex-wrap justify-center gap-1.5 rounded-md p-1.5" style={{ background: alpha(T.cyan, 0.06) }}>
              {g.views.map(([k, lbl]) => (
                <Pill key={k} on={view === k} onClick={() => setView(k)}>
                  {lbl}
                </Pill>
              ))}
            </div>
          )}
        </div>
      </Frame>
      <Frame title="Alerts Set bar" note="Shows only when the member has at least one alert. Manage leaves the page for the alerts page · no dialog.">
        <Bar>
          <span className="text-xs font-bold text-fg">⚑ Alerts Set</span>
          {['⟳ Repeated $500K+ · 80% ask · OTM', '⚡︎ One print $500K+ · 80% ask · OTM', '▮ One-shot $1M+ · 80% ask · OTM'].map((x) => (
            <span key={x} className="rounded-md border border-line bg-raised px-2 py-1 font-mono text-xs text-fg">
              <b>Whole tape</b> {x} <span className="ml-1.5 text-muted">✕</span>
            </span>
          ))}
          <span className="ml-auto">
            <Pill on>Manage → alerts</Pill>
          </span>
        </Bar>
      </Frame>
      {mode === 'one' ? (
        <Frame title={`Toolbar · ${titleOf(view)}`} note={view === 'options' ? 'Click Stocks ▾, ★ Presets ▾, ● Live ▾ and ⚙ Filters ▾ to open each one.' : undefined}>
          <ViewToolbar view={view} />
        </Frame>
      ) : (
        allViews.map(([k, lbl]) => (
          <Frame key={k} title={`Toolbar · ${lbl}`}>
            <ViewToolbar view={k} />
          </Frame>
        ))
      )}
      <Frame title="Every dropdown on the Flow toolbars, open">
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <Label>STOCKS ▾</Label>
            <Menu value="Stocks" items={['Stocks', 'ETFs', 'All']} />
          </div>
          <div>
            <Label>● LIVE ▾</Label>
            <Menu value="● Live" items={['● Live', '↺ 2026-09-24', '↺ 2026-09-23', '↺ 2026-09-22']} />
          </div>
          <div>
            <Label>EXPIRY ▾ (in Filters)</Label>
            <Menu value="Any date" items={['Any date', 'Fri Sep 25 · 0d', 'Mon Sep 28 · 3d', 'Fri Oct 2 · 7d', 'Fri Oct 16 · 21d']} />
          </div>
          <div>
            <Label>CONTRACT PRICE ▾</Label>
            <Menu value="Any price" items={['Any price', '$1.00 or less', '$2.50 or less', '$5.00 or less', '$10.00 or less']} />
          </div>
          <div>
            <Label>MIN PREMIUM ▾ (Repeated / One-Shots)</Label>
            <Menu value="Any premium" items={['Any premium', '$100K+', '$250K+', '$500K+', '$1M+']} />
          </div>
          <div>
            <Label>STRIKES ▾ (Net Drift)</Label>
            <Menu className="w-48" value="Core strikes" items={['Core strikes', 'Out of the money', 'Near the money (±2%)', 'All strikes']} />
          </div>
          <div>
            <Label>★ PRESETS ▾</Label>
            <PresetsPop />
          </div>
        </div>
      </Frame>
      <Frame title="⚙ Filters panel, open">
        <FiltersPanel />
      </Frame>
      <Notes
        items={[
          'Options Flow carries ~18 controls in one row before ⚙ Filters opens 11 more rows.',
          'Size lives in three places: the Size chips (market cap), ⚙ Filters › Size (premium), and the Presets inside Filters.',
          '★ Presets appears on 4 boards; the two named presets (Whales, Big LEAPs) live inside ⚙ Filters, not the ★ Presets menu.',
          '⚡︎ 0DTE is a chip here and a Days-out option inside Filters · two doors.',
          'Most Active has one view, so its sub-row never shows · its page header still says “Leaders”.',
        ]}
      />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// 3 · ACCOUNT MENU (bottom-left of the rail)
// ═════════════════════════════════════════════════════════════════════════════

type Who = 'member' | 'owner' | 'free'

function AccountPop({ who }: { who: Who }) {
  const admin = who === 'owner'
  const member = who !== 'free'
  const plan: [string, string] = admin ? ['VOLTICK · OWNER', VT.volt] : member ? ['Voltick member', VT.good] : ['Free account', T.muted]
  const sec = (t: string) => <div className="px-3 pb-1 pt-2 font-mono text-3xs font-extrabold uppercase tracking-widest text-muted">{t}</div>
  const row = (icon: string, label: string, right?: ReactNode, danger = false) => (
    <div className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold" style={{ color: danger ? VT.bad : T.text }}>
      <span aria-hidden className="w-4 text-center">{icon}</span>
      <span>{label}</span>
      {right}
    </div>
  )
  return (
    <div
      className="flex w-64 flex-col gap-px rounded-lg border border-line bg-surface p-1.5"
      style={{ boxShadow: `0 16px 44px ${alpha('var(--color-shadow)', 0.6)}` }}
    >
      <div className="mb-0.5 flex items-center gap-3 border-b border-line px-3 pb-3.5 pt-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-accent bg-accent font-mono text-base font-extrabold text-fg">B</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-fg">member@example.com</div>
          <div className="mt-0.5 font-mono text-3xs tracking-wide" style={{ color: plan[1] }}>
            ● {plan[0]}
          </div>
        </div>
      </div>
      {admin && (
        <div className="mx-0 my-1 flex items-center gap-2.5 rounded-md border border-accent px-3 py-2.5" style={{ background: alpha(T.cyan, 0.16) }}>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-fg">Owner Dashboard + tools</span>
            <span className="mt-px block font-mono text-2xs text-accent">the research panels</span>
          </span>
          <span className="ml-auto text-accent">→</span>
        </div>
      )}
      {sec('Account')}
      {row('⌕', 'Search', <span className="ml-auto rounded border border-line px-1.5 font-mono text-2xs">⌘K</span>)}
      {row('▤', 'Trade Journal')}
      {row('⚙', 'Settings')}
      {row('✦', "What's New")}
      {member && row('✦', 'Connect An Agent')}
      {member && row('▭', 'Manage Billing')}
      {sec('Learn')}
      {row('▯', 'How To Use Voltick')}
      {row('≡', 'Blog')}
      {row('‹›', 'API')}
      {sec('Community')}
      {row('⚇', 'Affiliates')}
      {row('?', 'Contact Support', <span className="ml-auto rounded-full bg-accent px-1.5 font-mono text-2xs font-extrabold text-fg">1</span>)}
      {row('◌', 'Suggestions')}
      {row('⚇', 'Connect Discord')}
      <div className="mx-1.5 my-1 h-px bg-line" />
      {row('⇥', 'Sign out', undefined, true)}
    </div>
  )
}

// ── The two rails the Settings preview can draw ──────────────────────────────
// Voltick's shelves, copied from its theme.jsx TOOLS_GROUPS / RAIL_VIEWS.
type Shelf = { label: string; icon: string; items: [string, string][] }

const VOLTICK_SHELVES: Shelf[] = [
  { label: 'Education', icon: '?', items: [['Where To Start', '/start'], ['How To Use Voltick', '/how-to-use'], ['Learn', '/learn'], ['FAQ', '/faq']] },
  {
    label: 'The Board',
    icon: '▦',
    items: [['Single', '/'], ['Multi', '/multi'], ['Chart', '/chart'], ['Terminal', '/terminal'], ['Scanner', '/scanner'], ['Grid', '/grid'], ['Replay', '/replay']],
  },
  { label: 'Flow', icon: '≈', items: [['Flow', '/flow']] },
  {
    label: 'Read The Market',
    icon: '≡',
    items: [['News Feed', '/news'], ['News Calendar', '/calendar'], ['Earnings', '/earnings'], ['The Daily', '/daily'], ['Seasonality', '/seasonality'], ['Expected Moves', '/expected-moves'], ['Filings', '/filings'], ['Dividends', '/dividends']],
  },
  { label: 'Track Record', icon: '▤', items: [['Track Record', '/calibration']] },
  {
    label: 'Yours',
    icon: '☆',
    items: [['Today', '/today'], ['Trade Journal', '/journal'], ['Your Fuse Agent', '/agent'], ['Alerts', '/alerts'], ['Your Positions', '/book'], ['Your Levels', '/export']],
  },
]

// v3's rail is flat, so it is one "shelf" per icon — read from Shell's NAV, so a
// page added there shows up here the same build.
function v3Shelves(): Shelf[] {
  return [{ label: 'CB Edge v3 rail', icon: '◧', items: NAV.map((n) => [`${n.icon} ${n.label}`, n.to] as [string, string]) }]
}

function MiniRail({ shelves, hidden, hiddenShelves, footer }: { shelves: Shelf[]; hidden: Set<string>; hiddenShelves: Set<string>; footer?: ReactNode }) {
  return (
    <div className="flex min-h-[520px] w-44 shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-rail">
      <div className="px-3 pb-2 pt-3 text-sm font-bold text-fg">Menu</div>
      <div className="flex-1 pb-2">
        {shelves
          .filter((s) => !hiddenShelves.has(s.label))
          .map((s) => {
            const kids = s.items.filter(([, to]) => !hidden.has(to))
            if (!kids.length) return null
            const leaf = s.items.length === 1
            return (
              <div key={s.label} className="mb-2">
                <div className="flex h-7 items-center text-sm font-semibold text-fg">
                  <span className="w-10 shrink-0 text-center text-muted">{s.icon}</span>
                  <span className="truncate">{leaf ? kids[0]![0] : s.label}</span>
                  {!leaf && <span className="ml-auto mr-2.5 text-3xs text-muted">▾</span>}
                </div>
                {!leaf &&
                  kids.map(([l, to]) => (
                    <div key={to} className="flex h-6 items-center truncate pl-10 pr-2 text-xs text-muted">
                      {l}
                    </div>
                  ))}
              </div>
            )
          })}
      </div>
      {footer}
    </div>
  )
}

function AccountTab() {
  const [who, setWho] = useState<Who>('member')
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm text-muted">Signed in as</span>
        <Seg value={who} onChange={setWho} options={[['member', 'Member'], ['owner', 'Owner'], ['free', 'Free account']] as const} />
      </div>
      <Frame title="Rail foot + account pop-up" note="The disc at the bottom of the left rail opens upward, anchored left. Rows by section: Account · Learn · Community · Sign out.">
        <div className="flex flex-wrap items-end">
          <MiniRail
            shelves={VOLTICK_SHELVES}
            hidden={new Set()}
            hiddenShelves={new Set()}
            footer={
              <div className="flex items-center gap-2 border-t border-line p-2.5">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent font-mono font-extrabold text-fg">B</span>
                <span className="text-xs text-fg">Account</span>
              </div>
            }
          />
          <div className="mb-2 ml-2">
            <AccountPop who={who} />
          </div>
        </div>
      </Frame>
      <Notes
        items={[
          '“How To Use Voltick” is in this menu AND in the rail’s Education shelf · two doors.',
          'Trade Journal is in this menu AND in the rail’s Yours shelf.',
          'API has only this door since the Developers shelf left the rail.',
        ]}
      />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// 4 · SETTINGS (NEW) · hide pages from the left rail
// ═════════════════════════════════════════════════════════════════════════════

type SettingsSec = 'menu' | 'board' | 'display' | 'alerts' | 'account'

function SettingsTab() {
  const [which, setWhich] = useState<'v3' | 'voltick'>('v3')
  const shelves = useMemo(() => (which === 'v3' ? v3Shelves() : VOLTICK_SHELVES), [which])
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [hiddenShelves, setHiddenShelves] = useState<Set<string>>(() => new Set())
  const [sec, setSec] = useState<SettingsSec>('menu')
  const [view, setView] = useState<'board' | 'multi' | 'chart' | 'scanner'>('board')
  const flip = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const nx = new Set(set)
    if (nx.has(k)) nx.delete(k)
    else nx.add(k)
    setter(nx)
  }
  const total = shelves.reduce((a, s) => a + s.items.length, 0)
  const shown = shelves.reduce((a, s) => a + (hiddenShelves.has(s.label) ? 0 : s.items.filter(([, to]) => !hidden.has(to)).length), 0)
  const NAVS: [SettingsSec, string][] = [
    ['menu', 'Menu & pages'],
    ['board', 'Board'],
    ['display', 'Display'],
    ['alerts', 'Notifications'],
    ['account', 'Account'],
  ]
  return (
    <div className="grid gap-5">
      <Box style={{ borderColor: alpha(VT.volt, 0.5) }}>
        <span className="text-sm text-fg">
          <b style={{ color: VT.volt }}>Proposal.</b> A reorganised Settings page with a new <b>Menu &amp; pages</b> section. Nothing here
          saves · the preview on the right updates as you hide rows.
        </span>
      </Box>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm text-muted">Rail to preview</span>
        <Seg
          value={which}
          onChange={(v) => {
            setWhich(v)
            setHidden(new Set())
            setHiddenShelves(new Set())
          }}
          options={[['v3', 'CB Edge v3'], ['voltick', 'Voltick']] as const}
        />
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="grid w-44 shrink-0 gap-1">
          {NAVS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSec(k)}
              className="rounded-md px-3 py-2 text-left text-sm font-semibold text-fg"
              style={sec === k ? { background: alpha(T.cyan, 0.18), boxShadow: `inset 2px 0 0 ${T.cyan}` } : undefined}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="grid min-w-0 flex-[1_1_420px] gap-2.5">
          {sec === 'menu' && (
            <>
              <Box>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="min-w-[200px] flex-1">
                    <div className="text-base font-bold text-fg">Left menu</div>
                    <div className="mt-1 text-xs text-muted">
                      Hide the pages you never open. They stay reachable from search and their own links · this only tidies the menu. Saved on this
                      device.
                    </div>
                  </div>
                  <span className="font-mono text-sm text-accent">
                    {shown} of {total} shown
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill
                    onClick={() => {
                      setHidden(new Set())
                      setHiddenShelves(new Set())
                    }}
                  >
                    ↺ Show everything
                  </Pill>
                </div>
              </Box>
              {shelves.map((s) => {
                const off = hiddenShelves.has(s.label)
                return (
                  <Box key={s.label} className={off ? 'opacity-60' : ''}>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-2xs font-extrabold uppercase tracking-wider text-fg">{s.label}</span>
                      <span className="text-xs text-muted">
                        {s.items.length} {s.items.length === 1 ? 'page' : 'pages'}
                      </span>
                      <span className="ml-auto inline-flex items-center gap-2">
                        <span className="text-xs text-muted">Whole shelf</span>
                        <Toggle on={!off} onClick={() => flip(hiddenShelves, setHiddenShelves, s.label)} />
                      </span>
                    </div>
                    {s.items.length > 1 && !off && (
                      <div className="mt-2.5 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
                        {s.items.map(([label, to]) => {
                          const on = !hidden.has(to)
                          return (
                            <div
                              key={to}
                              className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5"
                              style={on ? { background: alpha(T.cyan, 0.06) } : undefined}
                            >
                              <Toggle on={on} onClick={() => flip(hidden, setHidden, to)} />
                              <span className={`truncate text-sm font-semibold ${on ? 'text-fg' : 'text-muted line-through'}`}>{label}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </Box>
                )
              })}
            </>
          )}
          {sec === 'board' && (
            <>
              <Box>
                <Row label="Open the board on">
                  <Seg value={view} onChange={setView} options={[['board', 'Single'], ['multi', 'Multi'], ['chart', 'Chart'], ['scanner', 'Scanner']] as const} />
                </Row>
              </Box>
              <Box>
                <Row label="Starting symbol">
                  <Field ph="SPY" w="w-24" />
                </Row>
              </Box>
              <Box>
                <Row label="Chart style">
                  <span className="text-xs text-muted">Opens the ⚙ Style panel from tab 1</span>
                </Row>
              </Box>
            </>
          )}
          {sec === 'display' && (
            <>
              <Box>
                <Row label="Colour-blind palette">
                  <OnOff on={false} />
                </Row>
              </Box>
              <Box>
                <Row label="Hover tips">
                  <OnOff on />
                </Row>
              </Box>
              <Box>
                <Row label="Plain-English ribbon">
                  <OnOff on />
                </Row>
              </Box>
            </>
          )}
          {sec === 'alerts' && (
            <>
              <Box>
                <Row label="Push on this device">
                  <OnOff on />
                </Row>
              </Box>
              <Box>
                <Row label="Morning brief email">
                  <OnOff on={false} />
                </Row>
              </Box>
              <Box>
                <Row label="Every alert">
                  <Pill>Open Alerts →</Pill>
                </Row>
              </Box>
            </>
          )}
          {sec === 'account' && (
            <>
              <Box>
                <Row label="Email">
                  <span className="font-mono text-sm text-fg">member@example.com</span>
                </Row>
              </Box>
              <Box>
                <Row label="Billing">
                  <Pill>Manage Billing</Pill>
                </Row>
              </Box>
              <Box>
                <Row label="Delete account">
                  <Pill tone={VT.bad} on>
                    Delete…
                  </Pill>
                </Row>
              </Box>
            </>
          )}
        </div>

        <Frame title="Preview · your left menu">
          <MiniRail shelves={shelves} hidden={hidden} hiddenShelves={hiddenShelves} />
        </Frame>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// THE PAGE
// ═════════════════════════════════════════════════════════════════════════════

type Tab = 'chart' | 'flow' | 'account' | 'settings'
const TABS: [Tab, string][] = [
  ['chart', '⚙ Chart Style'],
  ['flow', '⚡︎ Flow Toolbars'],
  ['account', '◉ Account Menu'],
  ['settings', '☰ Settings (new)'],
]

function readHashTab(): Tab {
  const h = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
  return (TABS.find(([k]) => k === h)?.[0] ?? 'chart') as Tab
}

export default function Mockups() {
  const { isLoaded, isOwner } = useAuth()
  const [tab, setTab] = useState<Tab>(readHashTab)
  const pick = (k: Tab) => {
    setTab(k)
    try {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${k}`)
    } catch {
      /* ignore */
    }
  }
  if (!isLoaded) return <Page title="Mockups">{null}</Page>
  if (!isOwner) {
    return (
      <Page title="Mockups">
        <Box className="mx-auto mt-10 max-w-md text-center">
          <div className="text-base font-bold text-fg">Owner only</div>
          <div className="mt-1.5 text-sm text-muted">This design board is for the owner account.</div>
        </Box>
      </Page>
    )
  }
  return (
    <Page title="Mockups" actions={<span className="text-xs text-muted">Static pictures, laid flat for reorganising · nothing here is wired or saved</span>}>
      <div role="tablist" className="mb-2 flex w-fit max-w-full flex-wrap gap-1.5 rounded-lg border border-line bg-surface p-1.5">
        {TABS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => pick(k)}
            className={`rounded-md border px-3.5 py-2 text-sm font-bold text-fg ${tab === k ? 'border-accent' : 'border-transparent hover:bg-raised'}`}
            style={tab === k ? { background: alpha(T.cyan, 0.18) } : undefined}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'chart' && <ChartTab />}
      {tab === 'flow' && <FlowTab />}
      {tab === 'account' && <AccountTab />}
      {tab === 'settings' && <SettingsTab />}
    </Page>
  )
}
