// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE STUDIES — the manifest: every native study this folder defines, as
// Vela must know it up front (type, title, pane, inputs), registered in one
// call from pages/Vela.tsx before any workspace is built. Each lists on the
// chart's Indicators picker under Built-in, by its title. The code that loads
// and draws a study (levels / gex / flow / tpo.ts) is fetched the first time an
// instance of it starts, so the Vela page itself carries only this file.
//
//   levels.ts  CB Prior Levels · CB Initial Balance · CB Overnight High / Low
//   gex.ts     CB Expected Move · CB Key Levels · CB GEX Profile
//   flow.ts    CB Net Premium · CB Vol / GEX Flow · CB Net GEX · CB Net GEX Flow ·
//              CB Whale Prints
//   cvd.ts     CB Cumulative Volume Delta (buy vs sell volume on the ticker itself)
//   tpo.ts     CB Market Profile
//   rail.ts    CB GEX Rail (the GEX Candles card's strike rail, right or left of the chart)
//   heat.ts    CB GEX Heatmap (the per-minute ladders, behind the candles)
//   journal.ts CB Journal Trades (your journal's fills on the chart). HIDDEN
//              from the Indicators dialog for now (indicatorPicker.ts HIDDEN)
//              while the journal is redone for v3; still registered so a chart
//              that carries it opens.
//   events.ts  CB Events (economic releases, the engine's alerts and your script
//              alerts as marks along the bottom of the chart, eventsLayer.ts)
//
// None is put on a chart by itself but Events: Vela.tsx gives it to each chart
// once, like CB Walls and Voltick Path. The rest are the user's to add.
// ─────────────────────────────────────────────────────────────────────────────

import { defineStudy } from './common'

// ── Option lists the settings dialogs offer (the impl modules parse the same strings) ──
export const SESSION_BASIS = ['Regular hours', 'Full session'] as const
export const IB_WINDOWS = ['60 min', '30 min', '15 min'] as const
/** The GEX books' names. Not a study input any more: every study reads the page's one GEX switch (gexBasis.ts). */
export const GEX_BASIS = ['OI + Vol', 'OI only', 'Vol only'] as const
export const NP_MIN = ['$1K', '$25K', '$100K', '$500K'] as const
export const VF_SCOPES = ['All expiries', 'Front expiry'] as const
export const VF_SESSIONS = ['Regular hours', 'Extended hours'] as const
export const WH_MIN = ['$1M', '$2M', '$5M', '$10M'] as const
export const WH_SIDE = ['Calls and puts', 'Calls', 'Puts'] as const
export const WH_EXP = ['All expiries', '0DTE only', 'This week', 'Skip 0DTE'] as const
export const HEAT_SESSIONS = ['1', '2', '3'] as const
/** Net GEX's look: a line, columns, or both. */
export const NETGEX_STYLES = ['Line', 'Columns', 'Line and columns'] as const
/** Where Cumulative Volume Delta starts again from 0. */
export const CVD_ANCHORS = ['Session', 'Week', 'Month'] as const
export const CVD_STYLES = ['Candles', 'Line'] as const
export const RAIL_SIDES = ['Right', 'Left'] as const
/** The GEX Rail's look: a bar per strike, or Multi Greek's heatmap cell (rail.ts). */
export const RAIL_STYLES = ['Rail', 'Heatmap', 'Profile'] as const
/** The GEX Rail's expiries: the nearest one (the per-minute ladder) or every listed one summed (live). */
export const RAIL_EXPIRIES = ['Nearest (0DTE)', 'All expirations'] as const
export const JR_SHOW = ['All trades', 'Winners', 'Losers'] as const
/** Where a whale bubble reaches its biggest — anything larger draws that size too. */
export const WH_CAP = ['$25M', '$10M', '$50M', '$100M'] as const
/** A whale bubble's fill, % — 30 is how they always drew; 100 is solid. */
export const WH_OPACITY_DEF = 30
export const TPO_ROWS = ['Auto', '0.25', '0.5', '1', '2', '5', '10', '25'] as const
export const TPO_PERIODS = ['30 min', '15 min', '60 min'] as const

export const PRIOR_TYPE = 'cbedge-prior-levels'
export const IB_TYPE = 'cbedge-initial-balance'
export const ON_TYPE = 'cbedge-overnight'
export const EM_TYPE = 'cbedge-expected-move'
export const KEY_TYPE = 'cbedge-key-levels'
export const PROFILE_TYPE = 'cbedge-gex-profile'
export const NETPREM_TYPE = 'cbedge-net-premium'
export const VOLFLOW_TYPE = 'cbedge-vol-gex-flow'
export const NETGEX_TYPE = 'cbedge-net-gex'
export const NETGEXFLOW_TYPE = 'cbedge-net-gex-flow'
export const CVD_TYPE = 'cbedge-cvd'
export const WHALES_TYPE = 'cbedge-whale-prints'
export const TPO_TYPE = 'cbedge-market-profile'
export const RAIL_TYPE = 'cbedge-gex-rail'
export const HEAT_TYPE = 'cbedge-gex-heatmap'
export const JOURNAL_TYPE = 'cbedge-journal-trades'
export const EVENTS_TYPE = 'cbedge-events'

/** The Events study's mark size (events.ts): the token's side in px. */
export const EV_SIZES = ['Medium', 'Small', 'Large'] as const
/**
 * The kinds of mark the Events study draws, each an input of its own: the study's
 * settings dialog and the legend card's Events menu (legend/legendCard.ts) read
 * this one list. Low impact starts off, as it did on Vela's own lane.
 */
export const EV_KINDS = [
  { key: 'high', group: 'Releases', title: 'High impact', defval: true },
  { key: 'med', group: 'Releases', title: 'Medium impact', defval: true },
  { key: 'low', group: 'Releases', title: 'Low impact', defval: false },
  { key: 'volt', group: 'Engine alerts', title: 'Volt', defval: true },
  { key: 'flip', group: 'Engine alerts', title: 'Flip', defval: true },
  { key: 'ib', group: 'Engine alerts', title: 'IB', defval: true },
  { key: 'whale', group: 'Engine alerts', title: 'Whale', defval: true },
  { key: 'gex', group: 'Engine alerts', title: 'Top GEX', defval: true },
  { key: 'script', group: 'Your scripts', title: 'Script alerts', defval: true },
] as const
export type EvKind = (typeof EV_KINDS)[number]['key']

/** The studies that read today's numbers only, blank during a bar replay: type → the dock's name for it.
 *  (GEX Profile reads the recorded per-minute ladders while replaying instead.) */
export const LIVE_ONLY: Readonly<Record<string, string>> = { [KEY_TYPE]: 'Key Levels' }

export function registerStudies(): void {
  defineStudy(
    {
      type: PRIOR_TYPE,
      title: 'Voltick Prior Levels · previous day / week / month high, low, close',
      shortTitle: 'Prior Levels',
      pane: 'price',
      inputs: () => [
        { key: 'day', title: 'Previous day', type: 'bool', defval: true },
        { key: 'week', title: 'Previous week', type: 'bool', defval: true },
        { key: 'month', title: 'Previous month', type: 'bool', defval: false },
        { key: 'close', title: 'Previous close', type: 'bool', defval: true },
        { key: 'basis', title: 'Session', type: 'string', defval: SESSION_BASIS[0], options: SESSION_BASIS, tooltip: 'Which bars a session high / low is taken from.' },
        { key: 'sessions', title: 'Sessions drawn', type: 'int', defval: 1, min: 1, max: 120 },
        { key: 'tags', title: 'Price tags', type: 'bool', defval: true },
      ],
    },
    () => import('./levels').then((m) => m.priorImpl),
  )
  defineStudy(
    {
      type: IB_TYPE,
      title: 'Voltick Initial Balance · IB high / low / mid and extensions',
      shortTitle: 'Initial Balance',
      pane: 'price',
      inputs: () => [
        { key: 'window', title: 'IB window', type: 'string', defval: IB_WINDOWS[0], options: IB_WINDOWS },
        { key: 'ext', title: 'Extensions ×0.5 ×1 ×1.5 ×2', type: 'bool', defval: true },
        { key: 'mid', title: 'IB mid', type: 'bool', defval: true },
        { key: 'sessions', title: 'Sessions drawn', type: 'int', defval: 1, min: 1, max: 60 },
        { key: 'stats', title: 'Hit rates (ES / NQ, last 90 sessions)', type: 'bool', defval: true },
      ],
    },
    () => import('./levels').then((m) => m.ibImpl),
  )
  defineStudy(
    {
      type: ON_TYPE,
      title: 'Voltick Overnight High / Low · the pre-market range before the 09:30 open',
      shortTitle: 'Overnight H/L',
      pane: 'price',
      inputs: () => [
        { key: 'mid', title: 'Overnight mid', type: 'bool', defval: false },
        { key: 'sessions', title: 'Sessions drawn', type: 'int', defval: 1, min: 1, max: 8 },
        { key: 'tags', title: 'Price tags', type: 'bool', defval: true },
      ],
    },
    () => import('./levels').then((m) => m.overnightImpl),
  )
  defineStudy(
    {
      type: EM_TYPE,
      title: 'Voltick Expected Move · daily EM bands per session, and this week’s',
      shortTitle: 'Expected Move',
      pane: 'price',
      inputs: () => [
        { key: 'daily', title: 'Daily EM bands', type: 'bool', defval: true },
        { key: 'close', title: 'Reference close', type: 'bool', defval: true },
        { key: 'fill', title: 'Shade the band', type: 'bool', defval: true },
        { key: 'weekly', title: 'This week’s EM', type: 'bool', defval: true },
        { key: 'sessions', title: 'Sessions drawn', type: 'int', defval: 1, min: 1, max: 30 },
      ],
    },
    () => import('./gex').then((m) => m.emImpl),
  )
  defineStudy(
    {
      type: KEY_TYPE,
      title: 'Voltick Key Levels · Volt, Coil, Reversal, Flip, max pain, weekly pivot & zones',
      shortTitle: 'Key Levels',
      pane: 'price',
      liveOnly: true,
      gex: true,
      inputs: () => [
        { key: 'walls', title: '◆ Coil / ↘ Reversal', type: 'bool', defval: true },
        { key: 'core', title: '★ Volt (CORE, top net GEX)', type: 'bool', defval: true },
        { key: 'flip', title: 'Flip (gamma)', type: 'bool', defval: true },
        { key: 'maxPain', title: 'Max pain', type: 'bool', defval: true },
        { key: 'weekly', title: 'Weekly pivot', type: 'bool', defval: true },
        { key: 'zones', title: 'Weekly lower / upper zones', type: 'bool', defval: true },
      ],
    },
    () => import('./gex').then((m) => m.keyImpl),
  )
  defineStudy(
    {
      type: PROFILE_TYPE,
      title: 'Voltick GEX Profile · net GEX by strike beside the price axis',
      shortTitle: 'GEX Profile',
      pane: 'price',
      viewport: true,
      gex: true,
      inputs: () => [
        { key: 'width', title: 'Width (% of the chart)', type: 'int', defval: 22, min: 5, max: 60 },
        { key: 'strikes', title: 'Strikes each side of spot', type: 'int', defval: 30, min: 5, max: 120 },
        { key: 'tags', title: 'Tag the biggest', type: 'int', defval: 3, min: 0, max: 10 },
      ],
    },
    () => import('./gex').then((m) => m.profileImpl),
  )
  defineStudy(
    {
      type: NETPREM_TYPE,
      title: 'Voltick Net Premium · cumulative call / put / net option premium',
      shortTitle: 'Net Premium',
      pane: 'new',
      inputs: () => [
        {
          key: 'sessions',
          title: 'Sessions',
          type: 'int',
          defval: 1,
          min: 1,
          max: 7,
          tooltip: 'How many sessions back (up to 7). Each one starts at 0 at the 9:30 ET open.',
        },
        {
          key: 'legs',
          title: 'Calls and puts lines (no net line)',
          type: 'bool',
          defval: true,
          tooltip: 'On: a calls line and a puts line, and no net line. Off: the net line alone (calls less puts).',
        },
        { key: 'otm', title: 'OTM prints only', type: 'bool', defval: true, tooltip: 'The Net Premium card’s filter.' },
        { key: 'min', title: 'Smallest print', type: 'string', defval: NP_MIN[0], options: NP_MIN },
      ],
    },
    () => import('./flow').then((m) => m.netPremImpl),
  )
  defineStudy(
    {
      type: VOLFLOW_TYPE,
      title: 'Voltick Vol / GEX Flow · volume GEX, OI GEX and combined, today',
      shortTitle: 'Vol/GEX Flow',
      pane: 'new',
      inputs: () => [
        { key: 'scope', title: 'Expiries', type: 'string', defval: VF_SCOPES[0], options: VF_SCOPES },
        { key: 'session', title: 'Session', type: 'string', defval: VF_SESSIONS[0], options: VF_SESSIONS },
        { key: 'bin', title: 'Bucket (seconds)', type: 'int', defval: 60, min: 60, max: 900, step: 30 },
        { key: 'oi', title: 'OI GEX line', type: 'bool', defval: false },
        { key: 'combined', title: 'Combined line', type: 'bool', defval: true },
      ],
    },
    () => import('./flow').then((m) => m.volFlowImpl),
  )
  defineStudy(
    {
      type: NETGEX_TYPE,
      title: 'Voltick Net GEX · the ticker’s overall net GEX through the day, every strike summed',
      shortTitle: 'Net GEX',
      pane: 'new',
      gex: true,
      inputs: () => [
        { key: 'style', title: 'Style', type: 'string', defval: NETGEX_STYLES[0], options: NETGEX_STYLES },
        { key: 'scope', title: 'Expiries', type: 'string', defval: VF_SCOPES[0], options: VF_SCOPES },
        { key: 'session', title: 'Session', type: 'string', defval: VF_SESSIONS[0], options: VF_SESSIONS },
      ],
    },
    () => import('./flow').then((m) => m.netGexImpl),
  )
  defineStudy(
    {
      type: NETGEXFLOW_TYPE,
      title: 'Voltick Net GEX Flow · how net GEX is changing: per bar, and since the open, today',
      shortTitle: 'Net GEX Flow',
      pane: 'new',
      gex: true,
      inputs: () => [
        { key: 'scope', title: 'Expiries', type: 'string', defval: VF_SCOPES[0], options: VF_SCOPES },
        { key: 'session', title: 'Session', type: 'string', defval: VF_SESSIONS[0], options: VF_SESSIONS },
        {
          key: 'bars',
          title: 'Change per bar (histogram)',
          type: 'bool',
          defval: true,
          tooltip: 'Green: net GEX added in the bar. Red: net GEX taken off. On the page’s GEX switch (OI / OI + Vol / Vol).',
        },
        { key: 'line', title: 'Change since the open (line)', type: 'bool', defval: true, tooltip: 'Net GEX now less its first reading of the session.' },
      ],
    },
    () => import('./flow').then((m) => m.netGexFlowImpl),
  )
  defineStudy(
    {
      type: CVD_TYPE,
      title: 'Voltick Cumulative Volume Delta · buying less selling volume, from 1m intrabars, through the session',
      shortTitle: 'CVD',
      pane: 'new',
      inputs: () => [
        {
          key: 'anchor',
          title: 'Anchor period',
          type: 'string',
          defval: CVD_ANCHORS[0],
          options: CVD_ANCHORS,
          tooltip: 'Where the running total starts again from 0. Session: 6 PM ET for ES / NQ, the trading day otherwise.',
        },
        { key: 'style', title: 'Style', type: 'string', defval: CVD_STYLES[0], options: CVD_STYLES },
      ],
    },
    () => import('./cvd').then((m) => m.cvdImpl),
  )
  defineStudy(
    {
      type: WHALES_TYPE,
      title: 'Voltick Whale Prints · $1M+ option prints as bubbles sized by net premium',
      shortTitle: 'Whale Prints',
      pane: 'price',
      layer: { cursor: true },
      inputs: () => [
        { key: 'min', title: 'Smallest print', type: 'string', defval: WH_MIN[0], options: WH_MIN },
        { key: 'days', title: 'Days back', type: 'int', defval: 1, min: 1, max: 30 },
        { key: 'side', title: 'Show', type: 'string', defval: WH_SIDE[0], options: WH_SIDE },
        { key: 'exp', title: 'Expiry', type: 'string', defval: WH_EXP[0], options: WH_EXP, tooltip: '0DTE only: prints on contracts expiring that day. This week: expiring by that week’s Friday.' },
        {
          key: 'cap',
          title: 'Biggest bubble at',
          type: 'string',
          defval: WH_CAP[0],
          options: WH_CAP,
          tooltip: 'Net premium that draws the largest bubble. Bubble AREA follows premium up to here; anything bigger is drawn at this size.',
        },
        { key: 'size', title: 'Bubble size %', type: 'int', defval: 100, min: 50, max: 200, step: 10, tooltip: 'Scales every bubble: smallest and largest together.' },
        {
          key: 'opacity',
          title: 'Bubble opacity %',
          type: 'int',
          defval: WH_OPACITY_DEF,
          min: 5,
          max: 100,
          step: 5,
          tooltip: 'How solid the bubbles are filled: higher is darker and less see-through, lower lets the candles show through. The outline stays.',
        },
        { key: 'text', title: 'Premium in the bubble', type: 'bool', defval: true, tooltip: 'Written inside a bubble when it fits; hover any bubble for the prints.' },
      ],
    },
    () => import('./flow').then((m) => m.whalesImpl),
  )
  defineStudy(
    {
      type: TPO_TYPE,
      title: 'Voltick Market Profile · TPO per session (POC, value area, naked POCs)',
      shortTitle: 'Market Profile',
      pane: 'price',
      inputs: () => [
        { key: 'sessions', title: 'Sessions', type: 'int', defval: 1, min: 1, max: 15 },
        { key: 'row', title: 'Row size', type: 'string', defval: TPO_ROWS[0], options: TPO_ROWS },
        { key: 'period', title: 'TPO period', type: 'string', defval: TPO_PERIODS[0], options: TPO_PERIODS },
        { key: 'va', title: 'Value area %', type: 'int', defval: 70, min: 50, max: 95 },
        { key: 'lines', title: 'POC / VAH / VAL lines', type: 'bool', defval: true },
        { key: 'naked', title: 'Naked POCs run right', type: 'bool', defval: true },
        { key: 'basis', title: 'Session', type: 'string', defval: SESSION_BASIS[0], options: SESSION_BASIS },
        { key: 'opacity', title: 'Profile opacity %', type: 'int', defval: 35, min: 5, max: 90 },
      ],
    },
    () => import('./tpo').then((m) => m.tpoImpl),
  )
  defineStudy(
    {
      type: RAIL_TYPE,
      title: 'Voltick GEX Rail · the GEX strike rail beside the chart, right or left',
      shortTitle: 'GEX Rail',
      pane: 'price',
      layer: {},
      gex: true,
      inputs: () => [
        { key: 'side', title: 'Position', type: 'string', defval: RAIL_SIDES[0], options: RAIL_SIDES },
        {
          key: 'style',
          title: 'Style',
          type: 'string',
          defval: RAIL_STYLES[0],
          options: RAIL_STYLES,
          tooltip: 'Rail: a bar per strike. Heatmap: Multi Greek’s cell per strike, its GEX written in a cell shaded by size and sign. Profile: one smooth shape whose width is the GEX at each strike, blue above the flip and red below, the levels a line across in their colour. Which expiries: the Expiries setting.',
        },
        {
          key: 'exp',
          title: 'Expiries',
          type: 'string',
          defval: RAIL_EXPIRIES[0],
          options: RAIL_EXPIRIES,
          tooltip: 'Nearest (0DTE): the nearest expiry, minute by minute — the book the Voltick Path’s 0DTE walls are ranked on. All expirations: every listed expiry summed per strike, from the live chain (in a replay the rail keeps the nearest expiry, the only one recorded per minute).',
        },
        { key: 'tags', title: 'Level tags (Volt / Coil / Reversal / Surge)', type: 'bool', defval: true },
        { key: 'width', title: 'Rail width (px)', type: 'int', defval: 96, min: 72, max: 180, step: 4 },
      ],
    },
    () => import('./rail').then((m) => m.railImpl),
  )
  defineStudy(
    {
      type: HEAT_TYPE,
      title: 'Voltick GEX Heatmap · the per-minute GEX ladders behind the candles',
      shortTitle: 'GEX Heatmap',
      pane: 'price',
      layer: { cursor: true },
      gex: true,
      inputs: () => [
        { key: 'sessions', title: 'Sessions', type: 'string', defval: HEAT_SESSIONS[0], options: HEAT_SESSIONS, tooltip: 'The recorder keeps about two sessions of per-minute ladders.' },
        { key: 'opacity', title: 'Opacity %', type: 'int', defval: 55, min: 10, max: 95, step: 5 },
        { key: 'cut', title: 'Hide cells under % of the biggest', type: 'int', defval: 8, min: 0, max: 50 },
      ],
    },
    () => import('./heat').then((m) => m.heatImpl),
  )
  defineStudy(
    {
      type: JOURNAL_TYPE,
      title: 'Voltick Journal Trades · your journal’s trades on the chart',
      shortTitle: 'Journal',
      pane: 'price',
      layer: { cursor: true },
      inputs: () => [
        { key: 'show', title: 'Show', type: 'string', defval: JR_SHOW[0], options: JR_SHOW },
        { key: 'pnl', title: 'P&L beside each exit', type: 'bool', defval: true },
        { key: 'options', title: 'Options at the underlying’s price', type: 'bool', defval: true, tooltip: 'An option trade has no price on this chart; draw it where the underlying traded at that moment.' },
        { key: 'account', title: 'Account (blank = all)', type: 'string', defval: '' },
      ],
    },
    () => import('./journal').then((m) => m.journalImpl),
  )
  defineStudy(
    {
      type: EVENTS_TYPE,
      title: 'Voltick Events · economic releases, engine alerts and your script alerts along the bottom of the chart',
      shortTitle: 'Events',
      pane: 'price',
      layer: { cursor: true },
      inputs: () => [
        ...EV_KINDS.map((k) => ({ key: k.key, title: k.title, type: 'bool' as const, defval: k.defval, group: k.group })),
        { key: 'size', title: 'Size', type: 'string', defval: EV_SIZES[0], options: EV_SIZES, group: 'Look' },
      ],
    },
    () => import('./events').then((m) => m.eventsImpl),
  )
}
