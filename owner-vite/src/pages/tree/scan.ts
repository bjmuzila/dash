// ─────────────────────────────────────────────────────────────────────────────
// scan.ts — STATIC SNAPSHOT.
//
// The original (app/owner/dev/tree/scan.ts) walked the real filesystem with
// Node's `fs`/`path` and `process.cwd()` to count routes and list source files.
// That is server-only and cannot run in the browser, so this Vite port replaces
// the live scan with a hand-maintained static snapshot of the repo's structure
// (captured Jul 2026). The `App Routes` card + page count are derived from the
// owner nav (OWNER_SIDEBAR_GROUPS) so they stay in sync with the rail; the rest
// is a curated mirror of the tree. Update these arrays when the layout changes.
// ─────────────────────────────────────────────────────────────────────────────

import { OWNER_SIDEBAR_GROUPS, OWNER_ROUTES } from "../../lib/nav";

export type FileEntry = { name: string; desc: string };
export type CardData = { title: string; icon: string; files: FileEntry[] };
export type Summary = { label: string; value: string; accent: string };

// Curated descriptions; falls back to a generic label if a file isn't mapped.
const DESC: Record<string, string> = {
  "server-with-proxy.js": "Main server entry + proxy",
  "proxy-tastytrade.js": "Tastytrade API + dxLink stream",
  "websocket-server.js": "/ws/gex socket server",
  "levels-engine.js": "Levels / EM publisher",
  "levels-auto-publish.js": "Weekly auto-publish",
  "es-gap-tracker.js": "9:30 ES gap fill tracker",
  "mvc-auto-snapshot.js": "Auto MVC snapshots (30m)",
  "eod-gex-recorder.js": "End-of-day GEX recorder",
  "em-tracker-auto-eval.js": "EM tracker auto-eval",
  "em-tickers.js": "EM ticker universe",
  "ref-levels-recorder.js": "PDH/PDL + PWH/PWL cache",
  "ict-setup-tracker.js": "ICT setup logger + grader",
  "multi-flow.js": "Multi-ticker flow tape",
  "overview-generator.js": "7am AI market overview",
  "premarket-summary-generator.js": "Premarket AI summary",
  "strategy-generator.js": "AI strategy generator",
  "greeks-ts-writer.js": "Greeks timeseries writer",
  "greek-scanner-recorder.js": "Greek scanner snapshots",
  "scanner-recorder.js": "Multi-ticker scanner recorder",
  "scanner-tickers.js": "Scanner ticker universe",
  "strike-growth-recorder.js": "Strike Δ$ GEX growth tracker",
  "vol-pin-recorder.js": "Vol pin recorder",
  "flow-history-writer.js": "Premium flow history writer",
  "market-state.js": "Shared market-state store",
  "last-event-store.js": "Last-event store",
  "proxy-thetadata.js": "ThetaData API adapter",
  "ws-auth.js": "WS auth gate",
  "proxy-auth.js": "Proxy auth gate",
  "observability.js": "Logging / metrics",
  "data-source.js": "DATA_SOURCE flag",
  "gex.ts": "GEX math",
  "estimated-moves.ts": "Implied moves",
  "flow.ts": "Order flow logic",
  "calculations.ts": "Core calculations",
  "confidenceScore.ts": "Confidence scoring 0–100",
  "esGapMath.ts": "Shared ES gap math",
  "failLevels.ts": "Fade-trade fail levels",
  "snapdb.ts": "Snapshot DB helpers",
  "db.ts": "Postgres pool",
  "api.ts": "Client fetch layer",
  "google-sheets.ts": "Google Sheets import",
  "gex-calculator.js": "GEX calculator",
  "flow-processor.js": "Flow tape processor",
  "vex-chex.js": "Vanna / Charm exposure",
  "es-candle-writer.js": "ES 5m candle writer",
  "gex-history-writer.js": "GEX history writer",
};

function desc(f: string): string {
  return DESC[f] ?? "";
}

const mk = (name: string): FileEntry => ({ name, desc: desc(name) });

// ── Static snapshot of the source tree (Jul 2026) ────────────────────────────
const SERVER_ROOT: string[] = [
  "data-source.js", "em-tickers.js", "em-tracker-auto-eval.js", "eod-gex-recorder.js",
  "es-gap-tracker.js", "flow-history-writer.js", "greek-scanner-recorder.js",
  "greeks-ts-writer.js", "ict-setup-tracker.js", "last-event-store.js",
  "levels-auto-publish.js", "levels-engine.js", "market-state.js", "multi-flow.js",
  "mvc-auto-snapshot.js", "observability.js", "overview-generator.js",
  "premarket-summary-generator.js", "proxy-auth.js", "proxy-tastytrade.js",
  "proxy-thetadata.js", "ref-levels-recorder.js", "scanner-recorder.js",
  "scanner-tickers.js", "server-with-proxy.js", "strategy-generator.js",
  "strike-growth-recorder.js", "vol-pin-recorder.js", "websocket-server.js", "ws-auth.js",
];
const COMPUTE: string[] = [
  "es-candle-writer.js", "flow-processor.js", "gex-calculator.js",
  "gex-history-writer.js", "vex-chex.js",
];
const LIB_ROOT: string[] = [
  "api.ts", "db.ts", "estimated-moves.ts", "flow.ts", "gex.ts",
  "google-sheets.ts", "snapdb.ts",
];
const CALC: string[] = ["calculations.ts", "confidenceScore.ts", "esGapMath.ts", "failLevels.ts"];
const MD_DOCS: string[] = [
  "AGENTS.md", "ARCHITECTURE.md", "BUDGET_UI_STYLE.md", "CHANGELOG.md",
  "DEPLOY.md", "README.md", "SNAPSHOTS.md", "THEME.md",
];
const DEPS: string[] = [
  "next", "react", "react-dom", "pg", "ws", "recharts", "date-fns",
  "@supabase/supabase-js", "zod", "googleapis",
];

export function scanArchitecture(): {
  summary: Summary[];
  columns: { heading: string; accent: string; cards: CardData[] }[];
} {
  // Page count derived from the owner rail; other counts are snapshot values.
  const pageCount = OWNER_ROUTES.length;
  const apiCount = 64;
  const serverFiles = SERVER_ROOT.length + COMPUTE.length;
  const libFiles = LIB_ROOT.length + CALC.length;

  const appRouteFiles: FileEntry[] = OWNER_SIDEBAR_GROUPS.flatMap((g) =>
    g.links.map((l) => ({ name: l.label, desc: l.href.split("?")[0] })),
  );

  return {
    summary: [
      { label: "Page Routes", value: String(pageCount), accent: "#22d3ee" },
      { label: "API Routes", value: String(apiCount), accent: "#34d399" },
      { label: "Backend Files", value: String(serverFiles), accent: "#a78bfa" },
      { label: "Lib / Logic", value: String(libFiles), accent: "#f59e0b" },
    ],
    columns: [
      {
        heading: "Backend & Servers",
        accent: "#34d399",
        cards: [
          { title: "server-v2 (Node)", icon: "🖥️", files: SERVER_ROOT.map(mk) },
          { title: "Computation", icon: "⚙️", files: COMPUTE.map(mk) },
        ],
      },
      {
        heading: "Frontend Views",
        accent: "#22d3ee",
        cards: [
          { title: "Owner Rail", icon: "🖼️", files: appRouteFiles },
        ],
      },
      {
        heading: "Data & Logic",
        accent: "#f472b6",
        cards: [
          { title: "lib/ (root)", icon: "📦", files: LIB_ROOT.map(mk) },
          { title: "lib/calculations", icon: "🧮", files: CALC.map(mk) },
          { title: "Docs (*.md)", icon: "📄", files: MD_DOCS.map((f) => ({ name: f, desc: "" })) },
          { title: "Dependencies", icon: "🔌", files: DEPS.map((d) => ({ name: d, desc: "" })) },
        ],
      },
    ],
  };
}
