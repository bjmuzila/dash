import { unstable_cache } from "next/cache";
import { HOME_THEME as T } from "@/components/shared/homeTheme";
import {
  getDb,
  queryAll,
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

const CACHE_S = 900;

type Tone = "cyan" | "green" | "red" | "purple";
const toneColor: Record<Tone, string> = { cyan: T.cyan, green: T.green, red: T.red, purple: T.purple };

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
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted }}>
          {label}
        </span>
        <span style={liveTag}>
          <span style={liveDot} /> Live · delayed
        </span>
      </div>
      {children}
      <p style={{ color: T.muted, fontSize: 12, margin: "14px 0 0", lineHeight: 1.4, opacity: 0.75 }}>
        Real data, shown on a delay{freshness ? ` · ${freshness}` : ""}. Full live, tick-by-tick, is inside the dashboard for members.
      </p>
    </section>
  );
}

function StatGrid({ stats }: { stats: { label: string; value: string; tone?: Tone }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {stats.map((s) => (
        <div key={s.label} style={statCell}>
          <div style={{ color: T.muted, fontSize: 12, marginBottom: 6, opacity: 0.8 }}>{s.label}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: s.tone ? toneColor[s.tone] : T.text }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyBlock({ label, note }: { label: string; note: string }) {
  return (
    <Frame label={label}>
      <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.6, margin: 0 }}>{note}</p>
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
      <p style={{ color: T.muted, fontSize: 12, margin: "12px 0 0", lineHeight: 1.5, opacity: 0.85 }}>
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

/* ── TPO: latest completed Market Profile (tpo_profiles) ────────────────────── */

interface TpoRow { date: string; poc: number | null; vah: number | null; val: number | null; }

const tpoRow = unstable_cache(
  async (): Promise<TpoRow | null> => {
    try {
      const rows = await queryAll<TpoRow>(
        `SELECT date, poc, vah, val FROM tpo_profiles WHERE symbol = ? ORDER BY date DESC LIMIT 1`,
        ["ESU"]
      );
      return rows[0] ?? null;
    } catch { return null; }
  },
  ["explore-delayed-tpo"],
  { revalidate: CACHE_S, tags: ["explore-delayed"] }
);

async function TpoLive() {
  const r = await tpoRow();
  if (!r) {
    return <EmptyBlock label="TPO · ES Market Profile" note="Completed Market Profiles populate here at the end of each session." />;
  }
  const va = r.vah != null && r.val != null ? `${fmt(r.val)}–${fmt(r.vah)}` : "—";
  return (
    <Frame label={`TPO · ES Market Profile · ${r.date}`}>
      <StatGrid stats={[
        { label: "Point of Control", value: fmt(r.poc), tone: "cyan" },
        { label: "Value Area High", value: fmt(r.vah), tone: "green" },
        { label: "Value Area Low", value: fmt(r.val), tone: "red" },
        { label: "Value Area", value: va, tone: "purple" },
      ]} />
    </Frame>
  );
}

/* ── router ─────────────────────────────────────────────────────────────────── */

export default async function DelayedLiveView({ slug }: { slug: string }) {
  // flow + confidence-score render their own richer live components on the page.
  switch (slug) {
    case "gex": return <GexLive />;
    case "estimated-moves": return <EmLive />;
    case "initial-balance": return <IbLive />;
    case "tpo": return <TpoLive />;
    default: return null;
  }
}

/* ── styles ─────────────────────────────────────────────────────────────────── */

const frameCard: React.CSSProperties = {
  marginTop: "clamp(24px,4vw,40px)",
  background: "linear-gradient(180deg, rgba(33,158,188,0.05), rgba(255,255,255,0.02))",
  border: "1px solid rgba(33,158,188,0.18)",
  borderRadius: 16,
  padding: "clamp(16px,3vw,24px)",
};
const frameHead: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 16,
};
const liveTag: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7,
  fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
  color: T.green, border: "1px solid rgba(142,202,230,0.35)", background: "rgba(142,202,230,0.08)",
  borderRadius: 999, padding: "3px 9px",
};
const liveDot: React.CSSProperties = {
  width: 6, height: 6, borderRadius: 999, background: T.green, boxShadow: `0 0 8px ${T.green}`,
};
const statCell: React.CSSProperties = {
  background: "rgba(0,0,0,0.3)", border: `1px solid ${T.border}`, borderRadius: 10, padding: 14,
};
