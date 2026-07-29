"use client";

/**
 * /strike-history — per-strike net GEX over time.
 *
 * Pick a date + expiry + strike and get every recorded snapshot for that ONE
 * strike out of `option_strike_gex_history`: net GEX, volume-weighted net GEX,
 * and where spot was at each reading. Answers "how did 7420 behave today"
 * without dropping to psql.
 *
 * Data: GET /api/strike-gex-series (server-v2/api-router.js), fetch-on-load +
 * an explicit refresh — no polling, so an open tab never hammers the pool.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME, homeRefreshButtonStyle, statTileStyle, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";

type DayMeta = { date: string; expiry: string; snaps: number };
type StrikeMeta = { strike: number; snaps: number; avgNetGex: number };
type Row = {
  t: number;
  spot: number | null;
  netGex: number;
  netVolGex: number | null;
  callGamma: number | null;
  putGamma: number | null;
};

const ET = "America/New_York";
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { timeZone: ET, hour12: false, hour: "2-digit", minute: "2-digit" });

function fmtM(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return (v / 1e6).toFixed(digits) + "M";
}

/**
 * Snapshots where net GEX steps hard while per-contract gamma does NOT move are
 * open-interest refreshes, not flow: gamma is the price-sensitivity term, OI is
 * the size term, so a jump with gamma flat can only have come from the OI side.
 * Marking them matters because levels either side of one are not comparable.
 */
function findOiSteps(rows: Row[]): number[] {
  if (rows.length < 12) return [];
  const deltas: number[] = [];
  for (let i = 1; i < rows.length; i++) deltas.push(Math.abs(rows[i].netGex - rows[i - 1].netGex));
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  if (median <= 0) return [];
  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const jump = Math.abs(rows[i].netGex - rows[i - 1].netGex);
    const g0 = rows[i - 1].callGamma;
    const g1 = rows[i].callGamma;
    const gammaFlat = g0 != null && g1 != null && Math.abs(g1 - g0) < 1e-6;
    if (jump > median * 6 && gammaFlat) out.push(i);
  }
  return out;
}

/* ── chart ────────────────────────────────────────────────────────────────── */

const VB_W = 1000;
const VB_H = 190;
const M = { l: 74, r: 62, t: 12, b: 26 };

function niceTicks(lo: number, hi: number, n: number): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function Panel({
  rows, values, color, title, note, fmt, refLine, refLabel, steps, hover, onHover, showXAxis,
}: {
  rows: Row[];
  values: (number | null)[];
  color: string;
  title: string;
  note: string;
  fmt: (v: number) => string;
  refLine?: number;
  refLabel?: string;
  steps: number[];
  hover: number | null;
  onHover: (i: number | null) => void;
  showXAxis: boolean;
}) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v != null) as { v: number; i: number }[];
  const n = rows.length;

  const { lo, hi } = useMemo(() => {
    if (!pts.length) return { lo: 0, hi: 1 };
    let mn = Math.min(...pts.map((p) => p.v));
    let mx = Math.max(...pts.map((p) => p.v));
    if (refLine != null) { mn = Math.min(mn, refLine); mx = Math.max(mx, refLine); }
    if (mn === mx) { mn -= 1; mx += 1; }
    const pad = (mx - mn) * 0.12;
    return { lo: mn - pad, hi: mx + pad };
  }, [pts, refLine]);

  const xAt = (i: number) => M.l + (n > 1 ? (i / (n - 1)) * (VB_W - M.l - M.r) : 0);
  const yAt = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * (VB_H - M.t - M.b);

  const path = pts.map((p, k) => `${k ? "L" : "M"}${xAt(p.i).toFixed(1)},${yAt(p.v).toFixed(1)}`).join("");
  const ticks = niceTicks(lo, hi, 4);
  const last = pts.length ? pts[pts.length - 1] : null;

  // hourly x gridlines, derived from the ET hour flipping between samples
  const hourIdx: number[] = [];
  for (let i = 1; i < n; i++) {
    if (hhmm(rows[i].t).slice(0, 2) !== hhmm(rows[i - 1].t).slice(0, 2)) hourIdx.push(i);
  }

  const svgRef = useRef<SVGSVGElement | null>(null);
  const handleMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el || n < 2) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * VB_W;
    const i = Math.round(((px - M.l) / (VB_W - M.l - M.r)) * (n - 1));
    onHover(Math.max(0, Math.min(n - 1, i)));
  }, [n, onHover]);

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: "inline-block" }} />
        {title}
      </div>
      <div style={{ fontSize: 11.5, color: HOME_THEME.green, opacity: 0.75, margin: "2px 0 4px" }}>{note}</div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }}
        onMouseMove={handleMove}
        onMouseLeave={() => onHover(null)}
      >
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={M.l} x2={VB_W - M.r} y1={yAt(tk)} y2={yAt(tk)} stroke={HOME_THEME.border} strokeWidth={1} />
            <text x={M.l - 9} y={yAt(tk) + 3.5} textAnchor="end" fontSize={10.5} fill={HOME_THEME.text} opacity={0.45}>
              {fmt(tk)}
            </text>
          </g>
        ))}

        {hourIdx.map((i) => (
          <g key={`h${i}`}>
            <line x1={xAt(i)} x2={xAt(i)} y1={M.t} y2={VB_H - M.b} stroke={HOME_THEME.border} strokeWidth={1} />
            {showXAxis && (
              <text x={xAt(i)} y={VB_H - M.b + 15} textAnchor="middle" fontSize={10.5} fill={HOME_THEME.text} opacity={0.45}>
                {hhmm(rows[i].t)}
              </text>
            )}
          </g>
        ))}

        {refLine != null && (
          <>
            <line x1={M.l} x2={VB_W - M.r} y1={yAt(refLine)} y2={yAt(refLine)} stroke={HOME_THEME.text} strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={VB_W - M.r + 7} y={yAt(refLine) + 3.5} fontSize={10.5} fontWeight={700} fill={HOME_THEME.text} opacity={0.55}>{refLabel}</text>
          </>
        )}

        {steps.map((i) => (
          <line key={`s${i}`} x1={xAt(i)} x2={xAt(i)} y1={M.t} y2={VB_H - M.b} stroke={HOME_THEME.red} strokeWidth={1.5} strokeDasharray="4 3" strokeOpacity={0.8} />
        ))}

        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {last && (
          <>
            <circle cx={xAt(last.i)} cy={yAt(last.v)} r={4} fill={color} stroke={HOME_THEME.bg} strokeWidth={2} />
            <text x={xAt(last.i) + 8} y={yAt(last.v) + 3.5} fontSize={10.5} fontWeight={700} fill={HOME_THEME.text} opacity={0.8}>
              {fmt(last.v)}
            </text>
          </>
        )}

        {hover != null && values[hover] != null && (
          <>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={M.t} y2={VB_H - M.b} stroke={HOME_THEME.text} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={xAt(hover)} cy={yAt(values[hover] as number)} r={4.5} fill={color} stroke={HOME_THEME.bg} strokeWidth={2} />
          </>
        )}

        <line x1={M.l} x2={VB_W - M.r} y1={VB_H - M.b} y2={VB_H - M.b} stroke={HOME_THEME.border} strokeWidth={1} />
      </svg>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function StrikeHistoryPage() {
  const [days, setDays] = useState<DayMeta[]>([]);
  const [strikes, setStrikes] = useState<StrikeMeta[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  const [dayKey, setDayKey] = useState("");      // "date|expiry"
  const [strike, setStrike] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "success" | "error">("idle");

  const [date, expiry] = dayKey ? dayKey.split("|") : ["", ""];

  // 1 — available (date, expiry) pairs
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/strike-gex-series?mode=meta");
        const j = await r.json();
        if (!alive) return;
        if (j.error) { setErr(String(j.error)); return; }
        const d: DayMeta[] = j.days ?? [];
        setDays(d);
        if (d.length && !dayKey) setDayKey(`${d[0].date}|${d[0].expiry}`);
      } catch (e) { if (alive) setErr(String(e)); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2 — strikes recorded for that day
  useEffect(() => {
    if (!date || !expiry) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/strike-gex-series?mode=strikes&date=${date}&expiry=${expiry}`);
        const j = await r.json();
        if (!alive) return;
        const s: StrikeMeta[] = j.strikes ?? [];
        setStrikes(s);
        // keep the current strike if it still exists, else jump to the one with
        // the largest average |net GEX| — the day's dominant gamma level.
        const keep = s.find((x) => String(x.strike) === strike);
        if (!keep) {
          const dominant = [...s].sort((a, b) => Math.abs(b.avgNetGex) - Math.abs(a.avgNetGex))[0];
          setStrike(dominant ? String(dominant.strike) : "");
        }
      } catch (e) { if (alive) setErr(String(e)); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, expiry]);

  // 3 — the series itself
  const loadSeries = useCallback(async () => {
    if (!date || !expiry || !strike) { setRows([]); return; }
    setRefreshState("refreshing");
    try {
      const r = await fetch(`/api/strike-gex-series?mode=series&date=${date}&expiry=${expiry}&strike=${strike}`);
      const j = await r.json();
      if (j.error) { setErr(String(j.error)); setRefreshState("error"); return; }
      setRows(j.rows ?? []);
      setErr(null);
      setRefreshState("success");
      setTimeout(() => setRefreshState("idle"), 1200);
    } catch (e) { setErr(String(e)); setRefreshState("error"); }
  }, [date, expiry, strike]);

  useEffect(() => { void loadSeries(); }, [loadSeries]);

  const steps = useMemo(() => findOiSteps(rows), [rows]);
  const strikeNum = Number(strike);

  const stats = useMemo(() => {
    if (!rows.length) return null;
    const g = rows.map((r) => r.netGex);
    const lo = Math.min(...g), hi = Math.max(...g);
    const flips = rows.filter((r, i) => i > 0 && Math.sign(r.netGex) !== Math.sign(rows[i - 1].netGex)).length;
    const vol = rows.map((r) => r.netVolGex).filter((v): v is number => v != null);
    const spots = rows.map((r) => r.spot).filter((v): v is number => v != null);
    return {
      current: g[g.length - 1],
      lo, loAt: hhmm(rows[g.indexOf(lo)].t),
      hi, hiAt: hhmm(rows[g.indexOf(hi)].t),
      flips,
      volFirst: vol[0] ?? null, volLast: vol[vol.length - 1] ?? null,
      spotLo: spots.length ? Math.min(...spots) : null,
      spotHi: spots.length ? Math.max(...spots) : null,
      spotNow: spots.length ? spots[spots.length - 1] : null,
      first: hhmm(rows[0].t), last: hhmm(rows[rows.length - 1].t),
    };
  }, [rows]);

  const tileLabel: React.CSSProperties = { fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.green, opacity: 0.7 };
  const tileValue: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: HOME_THEME.text, marginTop: 3, fontVariantNumeric: "tabular-nums" };
  const tileNote: React.CSSProperties = { fontSize: 11, color: HOME_THEME.green, opacity: 0.7, marginTop: 2 };

  const hoverRow = hover != null ? rows[hover] : null;

  return (
    <PageShell>
      <Card
        variant="classic"
        title="Strike GEX history"
        subtitle="One strike, every recorded snapshot. Net GEX is read from the stored column — not recomputed."
        padding={20}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 220 }}>
            <div style={tileLabel}>Session · expiry</div>
            <ThemedSelect
              value={dayKey}
              onChange={setDayKey}
              options={days.map((d) => ({
                value: `${d.date}|${d.expiry}`,
                label: d.date === d.expiry ? `${d.date} · 0DTE` : `${d.date} · exp ${d.expiry}`,
              }))}
              placeholder="Loading…"
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <div style={tileLabel}>Strike</div>
            <ThemedSelect
              value={strike}
              onChange={setStrike}
              options={strikes.map((s) => ({ value: String(s.strike), label: String(s.strike) }))}
              placeholder={strikes.length ? "Pick a strike" : "—"}
              disabled={!strikes.length}
            />
          </div>
          <button style={homeRefreshButtonStyle(refreshState)} onClick={() => void loadSeries()} disabled={refreshState === "refreshing"}>
            {refreshState === "refreshing" ? "Loading" : "Refresh"}
          </button>
          {stats && (
            <div style={{ fontSize: 11.5, color: HOME_THEME.green, opacity: 0.75, paddingBottom: 6 }}>
              {rows.length} snapshots · {stats.first}–{stats.last} ET
              {steps.length > 0 && ` · ${steps.length} OI refresh step${steps.length > 1 ? "s" : ""}`}
            </div>
          )}
        </div>

        {err && (
          <div style={{ marginTop: 12, fontSize: 12, color: HOME_THEME.red }}>{err}</div>
        )}

        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 16 }}>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={tileLabel}>Current net GEX</div>
              <div style={tileValue}>{fmtM(stats.current)}</div>
              <div style={tileNote}>{stats.last} ET</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={tileLabel}>Session low</div>
              <div style={tileValue}>{fmtM(stats.lo)}</div>
              <div style={tileNote}>at {stats.loAt}</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={tileLabel}>Session high</div>
              <div style={tileValue}>{fmtM(stats.hi)}</div>
              <div style={tileNote}>at {stats.hiAt}</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={tileLabel}>Sign flips</div>
              <div style={tileValue}>{stats.flips}</div>
              <div style={tileNote}>{stats.lo < 0 && stats.hi < 0 ? "short gamma all session" : stats.lo > 0 && stats.hi > 0 ? "long gamma all session" : "crosses zero"}</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={tileLabel}>Vol-weighted build</div>
              <div style={tileValue}>{fmtM(stats.volFirst, 0)} → {fmtM(stats.volLast, 0)}</div>
              <div style={tileNote}>
                {stats.volFirst && stats.volLast ? `${(stats.volLast / stats.volFirst).toFixed(1)}×` : "—"}
              </div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={tileLabel}>Spot range</div>
              <div style={tileValue}>{stats.spotLo?.toFixed(2) ?? "—"} – {stats.spotHi?.toFixed(2) ?? "—"}</div>
              <div style={tileNote}>now {stats.spotNow?.toFixed(2) ?? "—"}</div>
            </div>
          </div>
        )}
      </Card>

      <Card variant="dissolve" padding={24}>
        {!rows.length ? (
          <div style={{ fontSize: 13, color: HOME_THEME.green, opacity: 0.7, padding: "40px 0", textAlign: "center" }}>
            {strike ? "No snapshots for this strike." : "Pick a session and strike."}
          </div>
        ) : (
          <>
            <div style={{ minHeight: 22, fontSize: 12, color: HOME_THEME.text, opacity: 0.85, fontVariantNumeric: "tabular-nums", marginBottom: 6 }}>
              {hoverRow ? (
                <>
                  <strong>{hhmm(hoverRow.t)} ET</strong>
                  {"  ·  spot "}{hoverRow.spot?.toFixed(2) ?? "—"}
                  {"  ·  net GEX "}{fmtM(hoverRow.netGex)}
                  {"  ·  vol GEX "}{fmtM(hoverRow.netVolGex, 1)}
                  {"  ·  gamma "}{hoverRow.callGamma?.toFixed(4) ?? "—"}
                </>
              ) : (
                <span style={{ opacity: 0.55 }}>Hover the charts for a synced reading.</span>
              )}
            </div>

            <Panel
              rows={rows}
              values={rows.map((r) => r.netGex)}
              color={HOME_THEME.cyan}
              title={`Net GEX at ${strike}`}
              note="Stored net_gex. Dashed red marks a step where GEX jumped but per-contract gamma did not — an OI refresh, not flow."
              fmt={(v) => fmtM(v, 0)}
              steps={steps}
              hover={hover}
              onHover={setHover}
              showXAxis={false}
            />
            <Panel
              rows={rows}
              values={rows.map((r) => r.netVolGex)}
              color={HOME_THEME.orange}
              title="Net volume-weighted GEX"
              note="net_vol_gex — continuous across OI refreshes, so this is where real intraday accumulation shows."
              fmt={(v) => fmtM(v, 0)}
              steps={[]}
              hover={hover}
              onHover={setHover}
              showXAxis={false}
            />
            <Panel
              rows={rows}
              values={rows.map((r) => r.spot)}
              color={LIGHT_BLUE}
              title="Spot"
              note="Dashed line marks the selected strike."
              fmt={(v) => v.toFixed(0)}
              refLine={Number.isFinite(strikeNum) ? strikeNum : undefined}
              refLabel={strike}
              steps={[]}
              hover={hover}
              onHover={setHover}
              showXAxis
            />
          </>
        )}
      </Card>
    </PageShell>
  );
}
