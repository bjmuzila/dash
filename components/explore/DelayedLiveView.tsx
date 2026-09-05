import { unstable_cache } from "next/cache";
import { V3, V3_RADIUS, V3_TEXT, v3a } from "@/components/landing/v3Theme";
import {
  getDb,
  getIbDailyResults,
  getLatestHomeStaticSnapshot,
  type IbDailyResultRow,
} from "@/lib/db";

// Delayed-live dashboard view for the public /explore/[slug] pages.
//
// Server-rendered from lib/db DIRECTLY — never a client fetch to /api/*, so the
// signed-out visitor never trips the middleware auth gate (which would 307 the
// gated routes to "/"). Refresh cadence is the page's ISR `revalidate`; the GEX
// block also prints its own snapshot timestamp so freshness is transparent.
//
// The page renders dynamically (force-dynamic) because the build container has
// no DATABASE_URL — a prerender would freeze the empty states in. Each fetcher
// below is therefore unstable_cache'd for CACHE_S so the DB sees one query per
// window per block, not one per visitor.
//
// Every block is try/catch + graceful-empty (like Confidence7dTracker): a
// missing/empty table shows a "populates at end of day" line, never a 500 on a
// marketing page. flow + confidence-score already have their own dedicated
// live components (NetDriftExample / Confidence7dTracker) and are skipped here.
//
// ── 2026-09-05 ───────────────────────────────────────────────────────────────
// • The TPO block is gone with the /explore/tpo page — the scanner dropped that
//   tab on 2026-09-03 and this was the last thing querying `tpo_profiles` for a
//   customer-facing surface.
// • v3 surfaces and white text, same as the rest of the public tree. The
//   `opacity: .75 / .8 / .85` on three text styles is removed rather than
//   tuned: see the v3 THEME note in components/landing/LandingClient.tsx.
// • The three NEW explore pages (premarket, top-change-scanner, watch-scanner)
//   have no delayed-live block yet and correctly fall through to `null`. Each
//   would need its own recorder table read here; do not fake one with a static
//   number, which is precisely what this component exists to avoid.

const CACHE_S = 900;

type Tone = "cyan" | "green" | "red" | "purple";
const toneColor: Record<Tone, string> = {
  cyan: V3.levelCw,
  green: V3.up,
  red: V3.down,
  purple: V3.violet,
};

const fmt = (n: number | null | undefined, d = 0) =>
  n == null || !Number.isFinite(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

function etTime(ts: number | null): string {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(new Date(ts)) + " ET";
  } catch { return ""; }
}

/* ── shared frame ─────────────────────────────────────────────────────────── */

function Frame({ label, freshness, children }: { label: string; freshness?: string; children: React.ReactNode }) {
  return (
    <section style={frameCard}>
      <div style={frameHead}>
        <span style={{ fontSize: V3_TEXT.xs, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: V3.fg }}>
          {label}
        </span>
        <span style={liveTag}>
          <span style={liveDot} /> Live · delayed
        </span>
      </div>
      <div style={{ padding: "clamp(14px,2.4vw,20px)" }}>
        {children}
        <p style={{ color: V3.fg, fontSize: V3_TEXT.base, margin: "14px 0 0", lineHeight: 1.5 }}>
          Real data, shown on a delay{freshness ? ` · ${freshness}` : ""}. Full live, tick-by-tick, is inside the dashboard for members.
        </p>
      </div>
    </section>
  );
}

function StatGrid({ stats }: { stats: { label: string; value: string; tone?: Tone }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {stats.map((s) => (
        <div key={s.label} style={statCell}>
          <div style={{ color: V3.fg, fontSize: V3_TEXT.base, marginBottom: 6 }}>{s.label}</div>
          <div style={{ fontSize: V3_TEXT.xl, fontWeight: 700, color: s.tone ? toneColor[s.tone] : V3.fg }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyBlock({ label, note }: { label: string; note: string }) {
  return (
    <Frame label={label}>
      <p style={{ color: V3.fg, fontSize: V3_TEXT.body, lineHeight: 1.6, margin: 0 }}>{note}</p>
    </Frame>
  );
}

/* ── GEX: last frozen full-chain snapshot (same row /home serves unpaid) ────── */

const gexSnapshot = unstable_cache(
  async (): Promise<{ ts: number; payload: unknown } | null> => {
    try { return (await getLatestHomeStaticSnapshot()) ?? null; } catch { return null; }
  },
  ["explore-delayed-gex"],
  { revalidate: CACHE_S, tags: ["explore-delayed"] }
);

async function GexLive() {
  const row = await gexSnapshot();
  const p = (row?.payload ?? null) as Record<string, unknown> | null;
  const rows = Array.isArray(p?.gexRows) ? (p!.gexRows as unknown[]) : [];
  if (!p || !rows.length) {
    return <EmptyBlock label="SPX GEX · delayed snapshot" note="The delayed GEX snapshot populates during market hours — check back once the session is open." />;
  }
  const spot = Number(p.spot ?? p.spotDisplay ?? 0) || null;
  const callWall = (p.callWall as number | null) ?? null;
  const putWall = (p.putWall as number | null) ?? null;
  return (
    <Frame label="SPX GEX · delayed snapshot" freshness={etTime(row?.ts ?? null)}>
      <StatGrid stats={[
        { label: "SPX Spot", value: fmt(spot), tone: "cyan" },
        { label: "Strikes in profile", value: fmt(rows.length), tone: "purple" },
        { label: "Call Wall", value: fmt(callWall), tone: "green" },
        { label: "Put Wall", value: fmt(putWall), tone: "red" },
      ]} />
    </Frame>
  );
}

/* ── Estimated moves: graded EM-band coverage receipt (em_tracker) ──────────── */

const emStats = unstable_cache(
  async (): Promise<Record<string, unknown> | null> => {
    try {
      const pool = await getDb();
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE result = 'hit')::int            AS hits,
          COUNT(*) FILTER (WHERE result IN ('hit','miss'))::int  AS evaluated,
          COUNT(DISTINCT week_start) FILTER (WHERE result IN ('hit','miss'))::int AS weeks,
          COUNT(DISTINCT ticker) FILTER (WHERE result IN ('hit','miss'))::int     AS tickers
        FROM em_tracker
      `);
      return rows[0] ?? null;
    } catch { return null; }
  },
  ["explore-delayed-em"],
  { revalidate: CACHE_S, tags: ["explore-delayed"] }
);

async function EmLive() {
  const r = (await emStats()) ?? {};
  const n = Number((r as { evaluated?: unknown }).evaluated ?? 0);
  if (n < 30) {
    return <EmptyBlock label="Estimated moves · graded results" note="Graded EM-band results populate here as tracked weeks resolve." />;
  }
  const rr = r as Record<string, unknown>;
  const pct = Math.round((Number(rr.hits) / n) * 1000) / 10;
  return (
    <Frame label="Estimated moves · graded results">
      <StatGrid stats={[
        { label: "Weekly bands contained price", value: `${pct}%`, tone: "green" },
        { label: "Graded ticker-weeks", value: fmt(n), tone: "cyan" },
        { label: "Distinct weeks", value: fmt(Number(rr.weeks ?? 0)), tone: "purple" },
        { label: "Tickers tracked", value: fmt(Number(rr.tickers ?? 0)), tone: "cyan" },
      ]} />
      <p style={{ color: V3.fg, fontSize: V3_TEXT.base, margin: "12px 0 0", lineHeight: 1.55 }}>
        A 1-SD weekly band should contain price near 68% of the time — this is calibration, every graded week including the misses.
      </p>
    </Frame>
  );
}

/* ── Initial Balance: last graded session + trailing base rates (ES) ────────── */

const SIDE = (s: string | null) => (s === "H" ? "Upside" : s === "L" ? "Downside" : "—");
const rate = (rows: IbDailyResultRow[], key: keyof IbDailyResultRow) => {
  const graded = rows.filter((r) => r[key] != null);
  if (!graded.length) return null;
  return Math.round((graded.filter((r) => Number(r[key]) === 1).length / graded.length) * 100);
};

const ibRows = unstable_cache(
  async (): Promise<IbDailyResultRow[]> => {
    try { return await getIbDailyResults("ES", 40); } catch { return []; }
  },
  ["explore-delayed-ib"],
  { revalidate: CACHE_S, tags: ["explore-delayed"] }
);

async function IbLive() {
  const rows = await ibRows();
  if (!rows.length) {
    return <EmptyBlock label="Initial Balance · ES, last session" note="Graded IB results populate here at the end of each trading day." />;
  }
  const last = rows[0]; // newest first
  const single = rate(rows, "single_break");
  const ext10 = rate(rows, "ext_10");
  return (
    <Frame label={`Initial Balance · ES · ${last.date}`}>
      <StatGrid stats={[
        { label: "IB width bucket", value: last.width_bucket ? last.width_bucket[0].toUpperCase() + last.width_bucket.slice(1) : "—", tone: "purple" },
        { label: "First break", value: SIDE(last.break_side), tone: last.break_side === "H" ? "green" : last.break_side === "L" ? "red" : "cyan" },
        { label: `Single-break rate · ${rows.length}d`, value: single == null ? "—" : `${single}%`, tone: "cyan" },
        { label: `1.0× ext hit · ${rows.length}d`, value: ext10 == null ? "—" : `${ext10}%`, tone: "cyan" },
      ]} />
    </Frame>
  );
}

/* ── router ─────────────────────────────────────────────────────────────────── */

export default async function DelayedLiveView({ slug }: { slug: string }) {
  // flow + confidence-score render their own richer live components on the page.
  // premarket / top-change-scanner / watch-scanner have no delayed block yet —
  // see the 2026-09-05 note at the top before adding one.
  switch (slug) {
    case "gex": return <GexLive />;
    case "estimated-moves": return <EmLive />;
    case "initial-balance": return <IbLive />;
    default: return null;
  }
}

/* ── styles ─────────────────────────────────────────────────────────────────── */

const frameCard: React.CSSProperties = {
  marginTop: "clamp(24px,4vw,40px)",
  background: V3.surface,
  border: `1px solid ${V3.line}`,
  borderRadius: V3_RADIUS.md,
  overflow: "hidden",
};
const frameHead: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
  padding: "10px 14px", borderBottom: `1px solid ${V3.line}`, background: V3.surface2,
};
const liveTag: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7,
  fontSize: V3_TEXT.xs, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
  color: V3.refresh, border: `1px solid ${v3a(V3.refresh, 0.35)}`, background: v3a(V3.refresh, 0.1),
  borderRadius: V3_RADIUS.sm, padding: "3px 9px",
};
const liveDot: React.CSSProperties = {
  width: 6, height: 6, borderRadius: 999, background: V3.refresh,
};
const statCell: React.CSSProperties = {
  background: V3.surface2, border: `1px solid ${V3.line}`, borderRadius: V3_RADIUS.sm, padding: 14,
};
