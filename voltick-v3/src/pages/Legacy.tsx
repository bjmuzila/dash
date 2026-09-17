import { Card } from '@/design/primitives/Card'
import { Page } from '@/design/primitives/Page'

// ─────────────────────────────────────────────────────────────────────────────
// /legacy — THE V2 DOOR.
//
// v3 is served at /v3/*, v2 at /app/*, and both run at the same time until v3
// is complete (cbedge-v3/AGENTS.md: "There is no cutover day"). That leaves a
// gap nobody had a page for: a surface that exists in v2 and has no v3 route
// yet is, from inside v3, invisible. The rail cannot carry it — an icon that
// leaves the SPA is not a rail item — and App.tsx's no-catch-all rule means a
// link to an unbuilt v3 route lands on NotFound.
//
// So: one page that lists every v2 destination v3 does not answer, each one a
// real link to the v2 app. Not a "coming soon" list — these all WORK, they are
// just one path segment away.
//
// WHAT GOES IN THIS FILE
// Only routes that are in app-vite/src/App.tsx and NOT in cbedge-v3/src/App.tsx.
// When a page lands in v3, delete its entry here the same day: an entry that
// sends someone to v2 for something v3 now does is worse than no entry, because
// it reads as authoritative.
//
// The links are plain <a href>, deliberately — NavLink/`to` route inside the
// BrowserRouter's basename="/v3" and would produce /v3/app/…. Leaving v3 is a
// document navigation, and it should be: the two apps do not share a bundle,
// a socket or a store.
// ─────────────────────────────────────────────────────────────────────────────

const V2_BASE = '/app'

interface LegacyLink {
  /** v2 route, without the /app basename. */
  path: string
  label: string
  /** Rail-language glyph, matching v2's toolbar emoji where it had one. */
  icon: string
  /** What it is, and — where it matters — why v3 does not have it. */
  note: string
}

// ── Pages with NO v3 counterpart ─────────────────────────────────────────────
// Cross-checked against app-vite/src/App.tsx (v2) and src/App.tsx (v3).
// MULTI GREEK, BOARD and ES CANDLES came OUT of this list on 2026-09-06. All
// three are v3 CARDS on the home board now, and /app/mult-greek, /app/board and
// /app/es-candles redirect to /v3 (lib/v3Routes.ts, PORTED). The trade was made
// knowingly: a card is single-symbol and lives on a board you arrange, where the
// v2 pages were fixed multi-panel layouts. Linking to a path that redirects
// would be worse than not listing it — the link would look like a door and
// behave like a wall.
//
// ICT, JOURNAL, FAILS and GUIDE came out the same day, for a different reason:
// they are RETIRED, not ported. There is no v3 version and there is not going to
// be one, so /app/ict, /app/trading, /app/fails and /app/guide redirect to /v3
// and their toolbar icons are gone from v2 as well. (The NEXT route at /guide is
// untouched — only the SPA copy went.) A list of doors into a wing that is
// closing has to lose an entry the day the room does.
const NOT_IN_V3: LegacyLink[] = [
  {
    path: '/test',
    label: 'Test Lab',
    icon: '⚗️',
    note: 'Eleven bench tabs — Squeeze, Dealer Gamma, GEX Map, GEX Scanner, GEX%, Market Quality, Stat Prompter, Condition Rail, Flow Inventory, Prem Diff, Seasonality. Built in v3, then retired 2026-08-30.',
  },
  {
    path: '/levels',
    label: 'Levels',
    icon: '🧱',
    note: 'CB / call wall / put wall for the whole scanner universe — 169 tickers of the three numbers Multi Greek shows for four.',
  },
  {
    path: '/strike-history',
    label: 'Strike History',
    icon: '🕘',
    note: 'Per-strike history over the session. Lives under the Test Lab strip in v2.',
  },
  {
    path: '/confidence-score',
    label: 'Confidence Score',
    icon: '📐',
    note: 'The confidence model, scored and broken out by component.',
  },
]

// ── Pages v3 HAS, but only in part ───────────────────────────────────────────
// A v3 route exists, so it is not in the list above — but the v2 page still
// holds surfaces the port has not reached. These entries exist so "v3 has it"
// never gets read as "v3 has all of it".
const PARTIAL: LegacyLink[] = [
  {
    path: '/level-log',
    label: 'Level Log',
    icon: '🧱',
    note: 'v3 has the wall-migration chart and the range switch. The ticker rail, the log card, the capture rail, the churn strip and the timeline are still v2 only.',
  },
]

// ── Phone build ──────────────────────────────────────────────────────────────
// v2 ships seven phone tabs, v3 five. Two of v2's have no v3 equivalent.
const PHONE_ONLY: LegacyLink[] = [
  {
    path: '/m/chain',
    label: 'Option Chain (phone)',
    icon: '⛓️',
    note: "Removed from the v3 tab bar 2026-09-03, the day after it landed — a strike ladder read ACROSS a dozen numeric columns does not survive 390px. v2's phone chain is still here.",
  },
  {
    path: '/m/prep',
    label: 'Premarket Prep (phone)',
    icon: '🌅',
    note: 'The pre-open prep board, phone build. No v3 phone counterpart yet.',
  },
]

function LinkRow({ item }: { item: LegacyLink }) {
  return (
    <a
      href={`${V2_BASE}${item.path}`}
      className="group flex items-start gap-3 rounded-md border border-line bg-surface2 px-3 py-2.5 transition-colors hover:bg-raised"
    >
      <span aria-hidden className="mt-0.5 shrink-0 text-base leading-none">
        {item.icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-fg">{item.label}</span>
          <span className="tabular truncate text-2xs text-faint">
            {V2_BASE}
            {item.path}
          </span>
        </span>
        <span className="text-xs leading-snug text-muted">{item.note}</span>
      </span>
      <span
        aria-hidden
        className="mt-0.5 shrink-0 text-xs text-faint transition-colors group-hover:text-accent"
      >
        ↗
      </span>
    </a>
  )
}

function LinkList({ items }: { items: LegacyLink[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {items.map((item) => (
        <LinkRow key={item.path} item={item} />
      ))}
    </div>
  )
}

export default function Legacy() {
  return (
    <Page title="v2 Legacy">
      <p className="max-w-3xl text-xs leading-relaxed text-muted">
        v2 still runs at <span className="tabular text-fg">/app</span> and answers everything it
        always did. These are the destinations v3 does not have a route for — every link below
        leaves v3 and opens the v2 app. An entry disappears from this page the day its v3 route
        lands.
      </p>

      <Card title={`Not in v3 (${NOT_IN_V3.length})`} expandable={false}>
        <LinkList items={NOT_IN_V3} />
      </Card>

      <Card title="Ported in part — the rest is still in v2" expandable={false}>
        <LinkList items={PARTIAL} />
      </Card>

      <Card title="Phone build" expandable={false}>
        <LinkList items={PHONE_ONLY} />
      </Card>

      <p className="text-2xs leading-relaxed text-faint">
        Same account, same backend — <span className="tabular">server-v2/</span> serves both apps.
        Nothing here is a second copy of your data.
      </p>
    </Page>
  )
}
