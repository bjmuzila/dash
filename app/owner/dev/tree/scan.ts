import fs from "fs";
import path from "path";

export type FileEntry = { name: string; desc: string };
export type CardData = { title: string; icon: string; files: FileEntry[] };
export type Summary = { label: string; value: string; accent: string };

const ROOT = process.cwd();

function safeList(dir: string, filter: (f: string) => boolean): string[] {
  try {
    return fs.readdirSync(path.join(ROOT, dir)).filter(filter).sort();
  } catch {
    return [];
  }
}

function countRecursive(dir: string, match: (f: string) => boolean): number {
  let n = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(ROOT, d), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel);
      else if (match(e.name)) n++;
    }
  };
  walk(dir);
  return n;
}

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

export function scanArchitecture(): {
  summary: Summary[];
  columns: { heading: string; accent: string; cards: CardData[] }[];
} {
  // ── Summary counts ──
  const pageCount = countRecursive("app", (f) => f === "page.tsx");
  const apiCount = countRecursive("app/api", (f) => f === "route.ts");
  const serverFiles = countRecursive("server-v2", (f) => f.endsWith(".js"));
  const libFiles = countRecursive("lib", (f) => f.endsWith(".ts") || f.endsWith(".js"));

  // ── Backend column ──
  const serverRoot = safeList("server-v2", (f) => f.endsWith(".js"));
  const compute = safeList("server-v2/computation", (f) => f.endsWith(".js"));

  // ── Data & logic column ──
  const libRoot = safeList("lib", (f) => f.endsWith(".ts") || f.endsWith(".js"));
  const calc = safeList("lib/calculations", (f) => f.endsWith(".ts"));
  const mdDocs = safeList(".", (f) => f.endsWith(".md")).slice(0, 8);

  const deps = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
      return Object.keys(pkg.dependencies ?? {});
    } catch {
      return [];
    }
  })();

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
          {
            title: "server-v2 (Node)",
            icon: "🖥️",
            files: serverRoot.map((f) => ({ name: f, desc: desc(f) })),
          },
          {
            title: "Computation",
            icon: "⚙️",
            files: compute.map((f) => ({ name: f, desc: desc(f) })),
          },
        ],
      },
      {
        heading: "Frontend Views",
        accent: "#22d3ee",
        cards: [
          {
            title: "App Routes",
            icon: "🖼️",
            files: [
              { name: `${pageCount} pages`, desc: "app/**/page.tsx" },
              { name: `${apiCount} API routes`, desc: "app/api/**/route.ts" },
            ],
          },
        ],
      },
      {
        heading: "Data & Logic",
        accent: "#f472b6",
        cards: [
          {
            title: "lib/ (root)",
            icon: "📦",
            files: libRoot.map((f) => ({ name: f, desc: desc(f) })),
          },
          {
            title: "lib/calculations",
            icon: "🧮",
            files: calc.map((f) => ({ name: f, desc: desc(f) })),
          },
          {
            title: "Docs (*.md)",
            icon: "📄",
            files: mdDocs.map((f) => ({ name: f, desc: "" })),
          },
          {
            title: "Dependencies",
            icon: "🔌",
            files: deps.map((d) => ({ name: d, desc: "" })),
          },
        ],
      },
    ],
  };
}
