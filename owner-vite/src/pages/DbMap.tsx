// ─────────────────────────────────────────────────────────────────────────────
// /owner/db-map — what the Postgres is actually holding.
//
// Nav: lib/nav.ts (System group) → registry.ts key "DbMap". Owner-gated by
// AuthGate like every other page in this SPA.
//
// Reads GET /api/owner/db-map, which nginx proxies to the dashboard container
// (see the `owners` service in docker-compose.yml). Sizes, row estimates and
// index stats there are live catalog reads — cheap, nothing scans a table.
// The "holds" column comes from db_map_snapshot, written once a night by
// server-v2/state/retention-cleanup.js, because min(date) on a text date
// column is a sequential scan: 43s on option_strike_gex_history alone.
//
// THE COLUMN THAT MATTERS IS KEEPS vs HOLDS. A table holding more days than
// its declared cutoff is a retention policy that has stopped running. That
// exact condition went unnoticed from 2026-07-24 to 2026-09-09 and took the
// disk to 94% of 30GB while every other table pruned correctly.
//
// Note on colour: OWNER_THEME.text / textSecondary / textMuted / muted are ALL
// #FFFFFF in this theme — there is no grey. Secondary text is
// OWNER_THEME.green (#8ECAE6), which is what Card's own subtitle uses. Do not
// fake a grey by fading white.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRefreshButton } from "../hooks/useRefreshButton";
import {
  OWNER_THEME,
  TYPE,
  SOFT_RED,
  LIGHT_BLUE,
  ownerRgba,
  statTileStyle,
} from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";

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

const GB = 1024 ** 3;
const bytes = (b: number) => {
  if (b >= GB) return `${(b / GB).toFixed(b / GB >= 10 ? 1 : 2)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
};
const int = (n: number) => n.toLocaleString("en-US");
const dayLabel = (n: number) => (n === 1 ? "1 day" : `${n} days`);

// A cutoff of N days legitimately holds N, and a weekend gap adds two more.
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
  ok: OWNER_THEME.green,
  over: SOFT_RED,
  nopolicy: OWNER_THEME.orange,
  // Recessive step. No grey exists in this theme, so cyan is the dimmer blue —
  // "measured and fine" still reads brighter than "not measured".
  stale: OWNER_THEME.cyan,
  unknown: OWNER_THEME.cyan,
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const th: React.CSSProperties = {
  fontFamily: MONO, fontSize: TYPE.micro, letterSpacing: "0.1em",
  textTransform: "uppercase", fontWeight: 500, color: OWNER_THEME.green,
  textAlign: "left", padding: "10px 12px", whiteSpace: "nowrap",
  borderBottom: `1px solid ${OWNER_THEME.border}`,
  background: OWNER_THEME.panelInset,
};
const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: `1px solid ${ownerRgba(OWNER_THEME.text, 0.055)}`,
  verticalAlign: "middle",
};
const tdNum: React.CSSProperties = {
  ...td, textAlign: "right", fontFamily: MONO, fontSize: TYPE.label,
  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
};

export default function DbMap() {
  const [data, setData] = useState<DbMap | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/owner/db-map", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.detail || j?.error || `HTTP ${r.status}`);
    setData(j as DbMap);
    setErr(null);
  }, []);

  const refresh = useRefreshButton(
    useCallback(async () => {
      try { await load(); }
      catch (e) { setErr(e instanceof Error ? e.message : String(e)); throw e; }
    }, [load]),
  );

  useEffect(() => {
    load().catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const ageBy = new Map(data.ages.map((a) => [a.table, a]));
    const now = Date.now();
    return data.tables.map((t) => {
      const policy = data.policies[t.name];
      const age = ageBy.get(t.name);
      const keepDays = policy?.days ?? null;
      const newestAgeDays = age?.newest
        ? Math.round((now - Date.parse(age.newest)) / 86_400_000)
        : null;

      let state: State;
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
          <p style={{ fontSize: TYPE.body, color: SOFT_RED, margin: "0 0 14px", fontFamily: MONO }}>
            {err}
          </p>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 14, marginBottom: 14 }}>
          <span style={{
            fontFamily: MONO, fontSize: TYPE.display, fontWeight: 700,
            letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums",
            color: nearFull ? SOFT_RED : OWNER_THEME.text,
          }}>
            {data ? bytes(data.db.sizeBytes) : "—"}
          </span>
          <span style={{ fontFamily: MONO, fontSize: TYPE.body, color: OWNER_THEME.green }}>
            of {data ? bytes(data.db.limitBytes) : "—"} · {usedPct.toFixed(1)}% used
            {data ? ` · ${data.db.tableCount} tables` : ""}
          </span>
          <button
            type="button"
            id="db-map-refresh"
            onClick={() => void refresh.trigger()}
            style={{ ...refresh.style, marginLeft: "auto" }}
          >
            {refresh.label}
          </button>
        </div>

        <div style={{
          position: "relative", height: 30, borderRadius: 6,
          background: OWNER_THEME.panelInset, overflow: "hidden",
          border: `1px solid ${OWNER_THEME.border}`,
        }}>
          <div style={{
            position: "absolute", inset: "0 auto 0 0",
            width: `${Math.min(100, usedPct)}%`, borderRadius: 5,
            background: nearFull ? OWNER_THEME.red : OWNER_THEME.cyan,
            transition: "width .4s",
          }} />
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", marginTop: 6,
          fontFamily: MONO, fontSize: TYPE.micro, color: OWNER_THEME.green,
          fontVariantNumeric: "tabular-nums",
        }}>
          <span>0</span>
          <span>{data ? bytes(data.db.limitBytes / 2) : ""}</span>
          <span>{data ? bytes(data.db.limitBytes) : ""}</span>
        </div>
        <p style={{ fontSize: TYPE.label, color: OWNER_THEME.green, margin: "10px 0 0", lineHeight: 1.55 }}>
          Render&rsquo;s own gauge reads higher than this — it counts WAL and catalog on the same
          volume, typically 1&ndash;2&nbsp;GB above the database figure.
        </p>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <Tile label="Declared but not enforced" value={String(counts.over)}
              color={counts.over ? SOFT_RED : OWNER_THEME.green}
              note="Holds more days than its cutoff allows. Its prune is failing." />
        <Tile label="No cutoff at all" value={String(counts.nopolicy)}
              color={counts.nopolicy ? OWNER_THEME.orange : OWNER_THEME.green}
              note="Nothing prunes these. Small today, unbounded by design." />
        <Tile label="Stale feeds" value={String(counts.stale)}
              color={OWNER_THEME.cyan}
              note="No writes in over two weeks — retired, or broken." />
        <Tile label="Dead tuples" value={int(counts.dead)}
              color={LIGHT_BLUE}
              note="Space plain VACUUM freed for reuse. Only a rebuild returns it to disk." />
      </div>

      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="Table by table"
        subtitle="Bars share one linear scale — light is heap, dark is indexes."
      >
        {data && !data.agesCapturedAt && (
          <p style={{ fontSize: TYPE.body, color: OWNER_THEME.orange, margin: "0 0 14px", lineHeight: 1.55 }}>
            No age snapshot yet. <span style={{ fontFamily: MONO }}>db_map_snapshot</span> is written
            by the nightly retention run (00:05&ndash;00:40&nbsp;ET, weekdays), so the <b>holds</b>{" "}
            column fills in after the next one. Everything else here is live.
          </p>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720, fontSize: TYPE.body }}>
            <thead>
              <tr>
                <th style={th}>Table</th>
                <th style={th}>Size</th>
                <th style={{ ...th, textAlign: "right" }}>Rows</th>
                <th style={th}>Keeps</th>
                <th style={th}>Holds</th>
                <th style={th}>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ t, policy, age, keepDays, state }) => (
                <tr key={t.name} title={policy?.note || ""}>
                  <td style={{ ...td, fontFamily: MONO, fontSize: TYPE.label, whiteSpace: "nowrap" }}>
                    {t.name}
                  </td>
                  <td style={{ ...td, minWidth: 180 }}>
                    <div style={{
                      position: "relative", height: 8, borderRadius: 4,
                      background: OWNER_THEME.panelInset, overflow: "hidden",
                    }}>
                      <div style={{
                        position: "absolute", inset: "0 auto 0 0", borderRadius: 4,
                        width: `${(t.total / maxTotal) * 100}%`, background: OWNER_THEME.cyan,
                      }} />
                      <div style={{
                        position: "absolute", inset: "0 auto 0 0", borderRadius: 4,
                        width: `${(t.heap / maxTotal) * 100}%`, background: OWNER_THEME.green,
                      }} />
                    </div>
                    <div style={{
                      fontFamily: MONO, fontSize: TYPE.micro, marginTop: 4,
                      color: OWNER_THEME.green, fontVariantNumeric: "tabular-nums",
                    }}>
                      {bytes(t.total)} · {bytes(t.idx)} idx
                    </div>
                  </td>
                  <td style={tdNum}>{int(t.rows)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {keepDays == null ? (
                      <span style={{ fontFamily: MONO, fontSize: TYPE.label, color: OWNER_THEME.cyan }}>—</span>
                    ) : (
                      <span style={{
                        fontFamily: MONO, fontSize: TYPE.label, color: OWNER_THEME.text,
                        border: `1px solid ${OWNER_THEME.border}`, borderRadius: 5, padding: "2px 7px",
                      }}>
                        {dayLabel(keepDays)}
                      </span>
                    )}
                  </td>
                  <td style={{
                    ...td, whiteSpace: "nowrap", fontFamily: MONO, fontSize: TYPE.label,
                    fontVariantNumeric: "tabular-nums",
                    color: state === "over" ? SOFT_RED : OWNER_THEME.text,
                  }}>
                    {age?.spanDays != null ? dayLabel(age.spanDays) : "—"}
                    {age?.oldest && (
                      <span style={{ color: OWNER_THEME.green }}> · from {age.oldest}</span>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 7,
                      fontSize: TYPE.label, color: STATE_COLOR[state],
                    }}>
                      <i style={{
                        width: 7, height: 7, borderRadius: "50%", flex: "none",
                        background: STATE_COLOR[state],
                      }} />
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
        subtitle="An index far bigger than its table's data is bloat; one with no scans is dead weight. Retention fixes neither — only REINDEX does."
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: TYPE.body }}>
            <tbody>
              {(data?.indexes ?? []).map((i) => (
                <tr key={i.name}>
                  <td style={{ ...td, fontFamily: MONO, fontSize: TYPE.label, whiteSpace: "nowrap" }}>{i.name}</td>
                  <td style={{ ...td, fontFamily: MONO, fontSize: TYPE.micro, color: OWNER_THEME.green, whiteSpace: "nowrap" }}>
                    on {i.table}
                  </td>
                  <td style={tdNum}>{bytes(i.bytes)}</td>
                  <td style={{ ...tdNum, color: i.scans === 0 ? SOFT_RED : OWNER_THEME.text }}>
                    {i.scans === 0 ? "never used" : `${int(i.scans)} scans`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card variant="budget" accent={LIGHT_BLUE} title="How to read this">
        <ul style={{ fontSize: TYPE.subhead, color: OWNER_THEME.text, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
          <li>
            <b>Keeps</b> is read out of the code — <Mono>RETENTION</Mono> in{" "}
            <Mono>state/retention-cleanup.js</Mono> plus each recorder&rsquo;s{" "}
            <Mono>RETAIN_DAYS</Mono>. This page cannot drift from what actually runs.
          </li>
          <li>
            <b>Holds</b> is measured from the rows themselves, nightly, after the prune. A table
            holding more than it keeps has a prune that is failing silently.
          </li>
          <li>
            <b>Deleting rows never shrinks the database.</b> Plain <Mono>VACUUM</Mono> marks the
            space reusable in place; only <Mono>REINDEX</Mono> (no lock) or <Mono>VACUUM FULL</Mono>{" "}
            (exclusive lock, needs 2&times; the live size free) returns it to disk.
          </li>
          <li>
            <b>budget_* tables are exempt from all of this</b> — they are deliberately unbounded and
            must never be pruned. See the protection rule at the top of <Mono>AGENTS.md</Mono>.
          </li>
        </ul>
        {data && (
          <p style={{ fontSize: TYPE.label, color: OWNER_THEME.green, margin: "16px 0 0", fontFamily: MONO }}>
            live {new Date(data.generatedAt).toLocaleString()}
            {data.agesCapturedAt ? ` · ages ${new Date(data.agesCapturedAt).toLocaleString()}` : ""}
          </p>
        )}
      </Card>
    </PageShell>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span style={{ fontFamily: MONO, fontSize: TYPE.label }}>{children}</span>;
}

function Tile({ label, value, color, note }: {
  label: string; value: string; color: string; note: string;
}) {
  return (
    <div style={{ ...statTileStyle, display: "flex", flexDirection: "column", gap: 8, padding: "16px 18px" }}>
      <div style={{
        fontFamily: MONO, fontSize: TYPE.micro, letterSpacing: "0.12em",
        textTransform: "uppercase", color: OWNER_THEME.green,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: MONO, fontSize: 24, fontWeight: 700, lineHeight: 1, color,
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
      <div style={{ fontSize: TYPE.label, color: OWNER_THEME.green, lineHeight: 1.45 }}>{note}</div>
    </div>
  );
}
