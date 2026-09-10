// ─────────────────────────────────────────────────────────────────────────────
// /owner/db-map — what the Postgres is actually holding.
//
// Owner-gated by app/owner/layout.tsx (OwnerGuard) like every other /owner/*
// route; no per-page guard and no app-vite route entry — owner pages are
// Next-served, not part of the SPA. Nav entry lives in the "Backend" group of
// components/shared/OwnerSidebar.tsx.
//
// Reads GET /api/owner/db-map (server-v2/api-router.js). Sizes, row estimates
// and index stats are live catalog reads. The "holds" column comes from
// db_map_snapshot, written once a night by state/retention-cleanup.js, because
// min(date) on a text date column is a sequential scan — 43s on
// option_strike_gex_history alone — and cannot run in a request.
//
// The column that matters is KEEPS vs HOLDS. When a table holds more days than
// its cutoff declares, its retention has stopped working. That exact condition
// went unnoticed from 2026-07-24 to 2026-09-09 and took the disk to 94%.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HOME_THEME,
  LIGHT_BLUE,
  SOFT_RED,
  homeRefreshButtonStyle,
  statTileStyle,
  type RefreshState,
} from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

// ── shapes returned by /api/owner/db-map ────────────────────────────────────
type TableRow = {
  name: string;
  total: number; heap: number; idx: number; toast: number;
  rows: number; dead: number;
  lastAutovacuum: string | null;
};
type IndexRow = { table: string; name: string; bytes: number; scans: number };
type AgeRow = {
  table: string; dateColumn: string | null;
  oldest: string | null; newest: string | null;
  spanDays: number | null; capturedAt: string;
};
type Policy = { days: number | null; owner: string; note?: string };
type DbMap = {
  generatedAt: string;
  db: { sizeBytes: number; limitBytes: number; tableCount: number };
  tables: TableRow[];
  indexes: IndexRow[];
  ages: AgeRow[];
  agesCapturedAt: string | null;
  policies: Record<string, Policy>;
};

// ── formatting ──────────────────────────────────────────────────────────────
const GB = 1024 ** 3;
const bytes = (b: number) => {
  if (b >= GB) return `${(b / GB).toFixed(b / GB >= 10 ? 1 : 2)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
};
const int = (n: number) => n.toLocaleString("en-US");
const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

// Grace before "holds more than it keeps" counts as a failure: a cutoff of N
// days legitimately holds N, and a weekend gap can add two more.
const GRACE_DAYS = 3;

type State = "ok" | "over" | "nopolicy" | "stale" | "unknown";
const STATE_TEXT: Record<State, string> = {
  ok: "Enforced",
  over: "Not enforced",
  nopolicy: "No policy",
  stale: "Stale feed",
  unknown: "Not measured",
};
const STATE_COLOR: Record<State, string> = {
  ok: HOME_THEME.green,
  over: SOFT_RED,
  nopolicy: HOME_THEME.orange,
  stale: HOME_THEME.cyan,
  unknown: HOME_THEME.cyan,
};

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

export default function DbMapPage() {
  const [data, setData] = useState<DbMap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refresh, setRefresh] = useState<RefreshState>("idle");

  const load = useCallback(async () => {
    setRefresh("refreshing");
    try {
      const r = await fetch("/api/owner/db-map", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.detail || j?.error || `HTTP ${r.status}`);
      setData(j as DbMap);
      setErr(null);
      setRefresh("success");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRefresh("error");
    }
    setTimeout(() => setRefresh("idle"), 1400);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── derived: one row per table, policy joined to measured age ─────────────
  const rows = useMemo(() => {
    if (!data) return [];
    const ageBy = new Map(data.ages.map((a) => [a.table, a]));
    const today = Date.now();
    return data.tables.map((t) => {
      const policy = data.policies[t.name];
      const age = ageBy.get(t.name);
      const keepDays = policy?.days ?? null;

      let state: State;
      const newestAgeDays = age?.newest
        ? Math.round((today - Date.parse(age.newest)) / 86_400_000)
        : null;
      if (newestAgeDays != null && newestAgeDays > 14) state = "stale";
      else if (keepDays == null) state = "nopolicy";
      else if (age?.spanDays == null) state = "unknown";
      else if (age.spanDays > keepDays + GRACE_DAYS) state = "over";
      else state = "ok";

      return { t, policy, age, keepDays, state };
    });
  }, [data]);

  const counts = useMemo(() => {
    const c = { over: 0, nopolicy: 0, stale: 0, dead: 0 };
    for (const r of rows) {
      if (r.state === "over") c.over += 1;
      if (r.state === "nopolicy") c.nopolicy += 1;
      if (r.state === "stale") c.stale += 1;
      c.dead += r.t.dead;
    }
    return c;
  }, [rows]);

  const maxTotal = rows.length ? Math.max(...rows.map((r) => r.t.total)) : 1;
  const usedPct = data ? (data.db.sizeBytes / data.db.limitBytes) * 100 : 0;
  const nearFull = usedPct >= 85;

  return (
    <PageShell>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="Postgres retention map"
        subtitle="What each table writes, how long it keeps it, and whether the cutoff it declares is the cutoff it enforces."
      >
        {err && (
          <p style={{ fontSize: 15, color: SOFT_RED, margin: "0 0 14px", fontFamily: mono }}>
            {err}
          </p>
        )}

        {/* capacity */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 14, marginBottom: 14 }}>
          <span style={{ fontFamily: mono, fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em",
                         color: nearFull ? SOFT_RED : HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>
            {data ? bytes(data.db.sizeBytes) : "—"}
          </span>
          <span style={{ fontFamily: mono, fontSize: 14, color: HOME_THEME.green }}>
            of {data ? bytes(data.db.limitBytes) : "—"} · {usedPct.toFixed(1)}% used
            {data ? ` · ${data.db.tableCount} tables` : ""}
          </span>
          <button
            type="button"
            id="db-map-refresh"
            onClick={() => void load()}
            style={{ ...homeRefreshButtonStyle(refresh), marginLeft: "auto" }}
          >
            {refresh === "refreshing" ? "Reading…" : "Refresh"}
          </button>
        </div>

        <div style={{ position: "relative", height: 30, borderRadius: 6,
                      background: HOME_THEME.border, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: "0 auto 0 0",
                        width: `${Math.min(100, usedPct)}%`,
                        background: nearFull ? HOME_THEME.red : HOME_THEME.cyan,
                        borderRadius: 5, transition: "width .4s" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6,
                      fontFamily: mono, fontSize: 11, color: HOME_THEME.green }}>
          <span>0</span>
          <span>{data ? bytes(data.db.limitBytes / 2) : ""}</span>
          <span>{data ? bytes(data.db.limitBytes) : ""}</span>
        </div>
        <p style={{ fontSize: 13, color: HOME_THEME.green, margin: "10px 0 0", lineHeight: 1.55 }}>
          Render&rsquo;s own gauge reads higher than this — it counts WAL and catalog on the same
          volume, typically 1&ndash;2 GB above the database figure.
        </p>
      </Card>

      {/* tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <Tile
          label="Declared but not enforced"
          value={String(counts.over)}
          color={counts.over ? SOFT_RED : HOME_THEME.green}
          note="Holds more days than its cutoff allows. Its prune is failing."
        />
        <Tile
          label="No cutoff at all"
          value={String(counts.nopolicy)}
          color={counts.nopolicy ? HOME_THEME.orange : HOME_THEME.green}
          note="Nothing prunes these. Small today, unbounded by design."
        />
        <Tile
          label="Stale feeds"
          value={String(counts.stale)}
          color={HOME_THEME.cyan}
          note="No writes in over two weeks — retired, or broken."
        />
        <Tile
          label="Dead tuples"
          value={int(counts.dead)}
          color={LIGHT_BLUE}
          note="Space plain VACUUM freed for reuse. Only a rebuild returns it to disk."
        />
      </div>

      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="Table by table"
        subtitle="Bars share one linear scale — light is heap, dark is indexes."
      >
        {!data?.agesCapturedAt && (
          <p style={{ fontSize: 14, color: HOME_THEME.orange, margin: "0 0 14px", lineHeight: 1.55 }}>
            No age snapshot yet. <span style={{ fontFamily: mono }}>db_map_snapshot</span> is written
            by the nightly retention run (00:05&ndash;00:40 ET, weekdays), so the
            <b> holds</b> column fills in after the next one. Everything else on this page is live.
          </p>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720, fontSize: 14 }}>
            <thead>
              <tr>
                {["Table", "Size", "Rows", "Keeps", "Holds", "State"].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i === 2 ? "right" : "left",
                      fontFamily: mono, fontSize: 11, letterSpacing: "0.1em",
                      textTransform: "uppercase", fontWeight: 500,
                      color: HOME_THEME.green,
                      padding: "10px 12px", whiteSpace: "nowrap",
                      borderBottom: `1px solid ${HOME_THEME.border}`,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ t, policy, age, keepDays, state }) => (
                <tr key={t.name} title={policy?.note || ""}>
                  <td style={{ ...cell, fontFamily: mono, fontSize: 13, whiteSpace: "nowrap" }}>
                    {t.name}
                  </td>
                  <td style={{ ...cell, minWidth: 180 }}>
                    <div style={{ position: "relative", height: 8, borderRadius: 4,
                                  background: HOME_THEME.border, overflow: "hidden" }}>
                      <div style={{ position: "absolute", inset: "0 auto 0 0", borderRadius: 4,
                                    width: `${(t.total / maxTotal) * 100}%`, background: HOME_THEME.cyan }} />
                      <div style={{ position: "absolute", inset: "0 auto 0 0", borderRadius: 4,
                                    width: `${(t.heap / maxTotal) * 100}%`, background: HOME_THEME.green }} />
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 11, marginTop: 4,
                                  color: HOME_THEME.green, fontVariantNumeric: "tabular-nums" }}>
                      {bytes(t.total)} · {bytes(t.idx)} idx
                    </div>
                  </td>
                  <td style={{ ...cell, ...numCell }}>{int(t.rows)}</td>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    {keepDays == null ? (
                      <span style={{ fontFamily: mono, fontSize: 12, color: HOME_THEME.green }}>
                        —
                      </span>
                    ) : (
                      <span style={{ fontFamily: mono, fontSize: 12, color: HOME_THEME.text,
                                     border: `1px solid ${HOME_THEME.border}`, borderRadius: 5,
                                     padding: "2px 7px" }}>
                        {days(keepDays)}
                      </span>
                    )}
                  </td>
                  <td style={{ ...cell, whiteSpace: "nowrap", fontFamily: mono, fontSize: 12.5,
                               fontVariantNumeric: "tabular-nums",
                               color: state === "over" ? SOFT_RED : HOME_THEME.text }}>
                    {age?.spanDays != null ? days(age.spanDays) : "—"}
                    {age?.oldest && (
                      <span style={{ color: HOME_THEME.green }}> · from {age.oldest}</span>
                    )}
                  </td>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5,
                                   color: STATE_COLOR[state] }}>
                      <i style={{ width: 7, height: 7, borderRadius: "50%", flex: "none",
                                  background: STATE_COLOR[state] }} />
                      {STATE_TEXT[state]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="Largest indexes"
        subtitle="An index far bigger than its table's data is bloat; one with no scans is dead weight. Neither is fixed by retention — only by REINDEX."
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: 14 }}>
            <tbody>
              {(data?.indexes ?? []).map((i) => (
                <tr key={i.name}>
                  <td style={{ ...cell, fontFamily: mono, fontSize: 13, whiteSpace: "nowrap" }}>{i.name}</td>
                  <td style={{ ...cell, fontFamily: mono, fontSize: 12, color: HOME_THEME.green,
                               whiteSpace: "nowrap" }}>
                    on {i.table}
                  </td>
                  <td style={{ ...cell, ...numCell }}>{bytes(i.bytes)}</td>
                  <td style={{ ...cell, ...numCell,
                               color: i.scans === 0 ? SOFT_RED : HOME_THEME.text }}>
                    {i.scans === 0 ? "never used" : `${int(i.scans)} scans`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card variant="budget" accent={LIGHT_BLUE} title="How to read this">
        <ul style={{ fontSize: 15, color: HOME_THEME.text, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
          <li>
            <b>Keeps</b> is read out of the code — <span style={{ fontFamily: mono, fontSize: 13 }}>RETENTION</span>{" "}
            in <span style={{ fontFamily: mono, fontSize: 13 }}>state/retention-cleanup.js</span> plus each
            recorder&rsquo;s <span style={{ fontFamily: mono, fontSize: 13 }}>RETAIN_DAYS</span>. This page can&rsquo;t
            drift from what actually runs.
          </li>
          <li>
            <b>Holds</b> is measured from the rows themselves, once a night after the prune. A table
            holding more than it keeps has a prune that is failing silently.
          </li>
          <li>
            <b>Deleting rows never shrinks the database.</b> Plain{" "}
            <span style={{ fontFamily: mono, fontSize: 13 }}>VACUUM</span> marks the space reusable in
            place; only <span style={{ fontFamily: mono, fontSize: 13 }}>REINDEX</span> (no lock) or{" "}
            <span style={{ fontFamily: mono, fontSize: 13 }}>VACUUM FULL</span> (exclusive lock, needs
            2&times; the live size free) returns it to disk.
          </li>
          <li>
            Bulk deletes here run under a longer{" "}
            <span style={{ fontFamily: mono, fontSize: 13 }}>statement_timeout</span> than the app&rsquo;s
            120s role default, set per session — a startup-packet option cannot override a role
            setting.
          </li>
        </ul>
        {data && (
          <p style={{ fontSize: 13, color: HOME_THEME.green, margin: "16px 0 0", fontFamily: mono }}>
            live {new Date(data.generatedAt).toLocaleString()}
            {data.agesCapturedAt ? ` · ages ${new Date(data.agesCapturedAt).toLocaleString()}` : ""}
          </p>
        )}
      </Card>
    </PageShell>
  );
}

const cell = {
  padding: "10px 12px",
  borderBottom: `1px solid ${HOME_THEME.border}`,
  verticalAlign: "middle" as const,
};
const numCell = {
  textAlign: "right" as const,
  fontFamily: mono,
  fontSize: 12.5,
  fontVariantNumeric: "tabular-nums" as const,
  whiteSpace: "nowrap" as const,
};

function Tile({ label, value, color, note }: {
  label: string; value: string; color: string; note: string;
}) {
  return (
    <div style={{ ...statTileStyle, display: "flex", flexDirection: "column", gap: 8, padding: "16px 18px" }}>
      <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase",
                    color: HOME_THEME.green }}>
        {label}
      </div>
      <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 700, lineHeight: 1, color,
                    fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ fontSize: 13, color: HOME_THEME.green, lineHeight: 1.45 }}>{note}</div>
    </div>
  );
}
