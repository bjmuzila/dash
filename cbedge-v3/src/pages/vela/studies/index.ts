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
//   flow.ts    CB Net Premium · CB Vol / GEX Flow · CB Whale Prints
//   tpo.ts     CB Market Profile
//
// None is put on a chart by itself: they are the user's to add.
// ─────────────────────────────────────────────────────────────────────────────

import { defineStudy } from './common'

// ── Option lists the settings dialogs offer (the impl modules parse the same strings) ──
export const SESSION_BASIS = ['Regular hours', 'Full session'] as const
export const IB_WINDOWS = ['60 min', '30 min', '15 min'] as const
export const GEX_BASIS = ['OI + Vol', 'OI only', 'Vol only'] as const
export const NP_MIN = ['$1K', '$25K', '$100K', '$500K'] as const
export const VF_SCOPES = ['All expiries', 'Front expiry'] as const
export const VF_SESSIONS = ['Regular hours', 'Extended hours'] as const
export const WH_MIN = ['$1M', '$2M', '$5M', '$10M'] as const
export const WH_SIDE = ['Calls and puts', 'Calls', 'Puts'] as const
/** Where a whale bubble reaches its biggest — anything larger draws that size too. */
export const WH_CAP = ['$25M', '$10M', '$50M', '$100M'] as const
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
export const WHALES_TYPE = 'cbedge-whale-prints'
export const TPO_TYPE = 'cbedge-market-profile'

/** The studies that read today's numbers only, blank during a bar replay: type → the dock's name for it. */
export const LIVE_ONLY: Readonly<Record<string, string>> = { [KEY_TYPE]: 'Key Levels', [PROFILE_TYPE]: 'GEX Profile' }

export function registerStudies(): void {
  defineStudy(
    {
      type: PRIOR_TYPE,
      title: 'CB Prior Levels — previous day / week / month high, low, close',
      shortTitle: 'Prior Levels',
      pane: 'price',
      inputs: () => [
        { key: 'day', title: 'Previous day', type: 'bool', defval: true },
        { key: 'week', title: 'Previous week', type: 'bool', defval: true },
        { key: 'month', title: 'Previous month', type: 'bool', defval: false },
        { key: 'close', title: 'Previous close', type: 'bool', defval: true },
        { key: 'basis', title: 'Session', type: 'string', defval: SESSION_BASIS[0], options: SESSION_BASIS, tooltip: 'Which bars a session high / low is taken from.' },
        { key: 'sessions', title: 'Sessions drawn', type: 'int', defval: 10, min: 1, max: 120 },
        { key: 'tags', title: 'Price tags', type: 'bool', defval: true },
      ],
    },
    () => import('./levels').then((m) => m.priorImpl),
  )
  defineStudy(
    {
      type: IB_TYPE,
      title: 'CB Initial Balance — IB high / low / mid and extensions',
      shortTitle: 'Initial Balance',
      pane: 'price',
      inputs: () => [
        { key: 'window', title: 'IB window', type: 'string', defval: IB_WINDOWS[0], options: IB_WINDOWS },
        { key: 'ext', title: 'Extensions ×0.5 ×1 ×1.5 ×2', type: 'bool', defval: true },
        { key: 'mid', title: 'IB mid', type: 'bool', defval: true },
        { key: 'sessions', title: 'Sessions drawn', type: 'int', defval: 5, min: 1, max: 60 },
        { key: 'stats', title: 'Hit rates (ES / NQ, last 90 sessions)', type: 'bool', defval: true },
      ],
    },
    () => import('./levels').then((m) => m.ibImpl),
  )
  defineStudy(
    {
      type: ON_TYPE,
      title: 'CB Overnight High / Low — the pre-market range before the 09:30 open',
      shortTitle: 'Overnight H/L',
      pane: 'price',
      inputs: () => [
        { key: 'mid', title: 'Overnight mid', type: 'bool', defval: false },
        { key: 'sessions', title: 'Sessions drawn', type: 'int', defval: 5, min: 1, max: 8 },
        { key: 'tags', title: 'Price tags', type: 'bool', defval: true },
      ],
    },
    () => import('./levels').then((m) => m.overnightImpl),
  )
  defineStudy(
    {
      type: EM_TYPE,
      title: 'CB Expected Move — daily EM bands per session, and this week’s',
      shortTitle: 'Expected Move',
      pane: 'price',
      inputs: () => [
        { key: 'daily', title: 'Daily EM bands', type: 'bool', defval: true },
        { key: 'close', title: 'Reference close', type: 'bool', defval: true },
        { key: 'fill', title: 'Shade the band', type: 'bool', defval: true },
        { key: 'weekly', title: 'This week’s EM', type: 'bool', defval: true },
        { key: 'sessions', title: 'Sessions drawn', type: 'int', defval: 10, min: 1, max: 30 },
      ],
    },
    () => import('./gex').then((m) => m.emImpl),
  )
  defineStudy(
    {
      type: KEY_TYPE,
      title: 'CB Key Levels — walls, CORE, gamma flip, max pain, weekly pivot & zones',
      shortTitle: 'Key Levels',
      pane: 'price',
      liveOnly: true,
      inputs: () => [
        { key: 'walls', title: 'Call / Put walls', type: 'bool', defval: true },
        { key: 'core', title: 'CORE', type: 'bool', defval: true },
        { key: 'flip', title: 'Gamma flip', type: 'bool', defval: true },
        { key: 'maxPain', title: 'Max pain', type: 'bool', defval: true },
        { key: 'weekly', title: 'Weekly pivot', type: 'bool', defval: true },
        { key: 'zones', title: 'Weekly buy / sell zones', type: 'bool', defval: true },
      ],
    },
    () => import('./gex').then((m) => m.keyImpl),
  )
  defineStudy(
    {
      type: PROFILE_TYPE,
      title: 'CB GEX Profile — net GEX by strike beside the price axis',
      shortTitle: 'GEX Profile',
      pane: 'price',
      liveOnly: true,
      viewport: true,
      inputs: () => [
        { key: 'basis', title: 'GEX', type: 'string', defval: GEX_BASIS[0], options: GEX_BASIS },
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
      title: 'CB Net Premium — cumulative call / put / net option premium',
      shortTitle: 'Net Premium',
      pane: 'new',
      inputs: () => [
        { key: 'sessions', title: 'Sessions', type: 'int', defval: 1, min: 1, max: 5 },
        { key: 'legs', title: 'Calls and puts lines', type: 'bool', defval: true },
        { key: 'otm', title: 'OTM prints only', type: 'bool', defval: true, tooltip: 'The Net Premium card’s filter.' },
        { key: 'min', title: 'Smallest print', type: 'string', defval: NP_MIN[0], options: NP_MIN },
      ],
    },
    () => import('./flow').then((m) => m.netPremImpl),
  )
  defineStudy(
    {
      type: VOLFLOW_TYPE,
      title: 'CB Vol / GEX Flow — volume GEX, OI GEX and combined, today',
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
      type: WHALES_TYPE,
      title: 'CB Whale Prints — $1M+ option prints as bubbles sized by net premium',
      shortTitle: 'Whale Prints',
      pane: 'price',
      layer: { cursor: true },
      inputs: () => [
        { key: 'min', title: 'Smallest print', type: 'string', defval: WH_MIN[0], options: WH_MIN },
        { key: 'days', title: 'Days back', type: 'int', defval: 5, min: 1, max: 30 },
        { key: 'side', title: 'Show', type: 'string', defval: WH_SIDE[0], options: WH_SIDE },
        {
          key: 'cap',
          title: 'Biggest bubble at',
          type: 'string',
          defval: WH_CAP[0],
          options: WH_CAP,
          tooltip: 'Net premium that draws the largest bubble. Bubble AREA follows premium up to here; anything bigger is drawn at this size.',
        },
        { key: 'size', title: 'Bubble size %', type: 'int', defval: 100, min: 50, max: 200, step: 10, tooltip: 'Scales every bubble — smallest and largest together.' },
        { key: 'text', title: 'Premium in the bubble', type: 'bool', defval: true, tooltip: 'Written inside a bubble when it fits; hover any bubble for the prints.' },
      ],
    },
    () => import('./flow').then((m) => m.whalesImpl),
  )
  defineStudy(
    {
      type: TPO_TYPE,
      title: 'CB Market Profile — TPO per session: POC, value area, naked POCs',
      shortTitle: 'Market Profile',
      pane: 'price',
      inputs: () => [
        { key: 'sessions', title: 'Sessions', type: 'int', defval: 3, min: 1, max: 15 },
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
}
