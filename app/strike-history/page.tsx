"use client";

/**
 * /strike-history — per-strike net GEX and IV skew over time.
 *
 * Pick a date + expiry + strike and get every recorded snapshot for that ONE
 * strike out of `option_strike_gex_history`: net GEX, volume-weighted net GEX,
 * spot, and IV skew vs the at-the-money strike.
 *
 * Skew is `IV(K) − IV(ATM)`, where IV at a strike is the call/put average and
 * ATM is the strike nearest spot AT THAT SNAPSHOT (recomputed per tick, since
 * spot drifts through the session). The API returns it precomputed.
 *
 * Data: GET /api/strike-gex-series (server-v2/api-router.js), fetch-on-load +
 * explicit refresh — no polling, so an open tab never hammers the pool.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME, homeRefreshButtonStyle, statTileStyle, LIGHT_BLUE, SOFT_RED } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import ScannerTabsBar from "@/components/scanner/ScannerTabsBar";

type DayMeta = { date: string; expiry: string; snaps: number };
type StrikeMeta = { strike: number; snaps: number; avgNetGex: number };
type Row = {
  t: number;
  spot: number | null;
  netGex: number;
  netVolGex: number | null;
  callGamma: number | null;
  putGamma: number | null;
  callIv: number | null;
  putIv: number | null;
  ivK: number | null;
  atmStrike: number | null;
  atmIv: number | null;
  skew: number | null;
  skewPct: number | null;
};

const ET = "America/New_York";
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { timeZone: ET, hour12: false, hour: "2-digit", minute: "2-digit" });

const fmtM = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : (v / 1e6).toFixed(digits) + "M";
/** Skew arrives in vol decimals (0.021). Vol points read better on an axis. */
const fmtVp = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : (v > 0 ? "+" : "") + (v * 100).toFixed(digits);
const fmtIv = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : (v * 100).toFixed(1) + "%";

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

const VB_W = 560;
const VB_H = 210;
const M = { l: 62, r: 52, t: 12, b: 26 };

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
  rows, values, color, fmt, refLine, refLabel, steps, hover, onHover,
}: {
  rows: Row[];
  values: (number | null)[];
  color: string;
  fmt: (v: number) => string;
  refLine?: number;
  refLabel?: string;
  steps: number[];
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
  const n = rows.length;
  const pts = useMemo(
    () => values.map((v, i) => ({ v, i })).filter((p) => p.v != null && Number.isFinite(p.v as number)) as { v: number; i: number }[],
    [values]
  );

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

  // Break the path where data is missing instead of bridging the gap — a
  // straight line across an hour of nulls reads as a real flat reading.
  const path = useMemo(() => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
      pen = true;
    });
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, lo, hi, n]);

  const ticks = niceTicks(lo, hi, 4);
  const last = pts.length ? pts[pts.length - 1] : null;

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
          <text x={M.l - 8} y={yAt(tk) + 3.5} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.45}>
            {fmt(tk)}
          </text>
        </g>
      ))}

      {hourIdx.map((i) => (
        <g key={`h${i}`}>
          <line x1={xAt(i)} x2={xAt(i)} y1={M.t} y2={VB_H - M.b} stroke={HOME_THEME.border} strokeWidth={1} />
          <text x={xAt(i)} y={VB_H - M.b + 14} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.45}>
            {hhmm(rows[i].t)}
          </text>
        </g>
      ))}

      {refLine != null && (
        <>
          <line x1={M.l} x2={VB_W - M.r} y1={yAt(refLine)} y2={yAt(refLine)} stroke={HOME_THEME.text} strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="5 4" />
          {refLabel && (
            <text x={VB_W - M.r + 6} y={yAt(refLine) + 3.5} fontSize={10} fontWeight={700} fill={HOME_THEME.text} opacity={0.55}>{refLabel}</text>
          )}
        </>
      )}

      {steps.map((i) => (
        <line key={`s${i}`} x1={xAt(i)} x2={xAt(i)} y1={M.t} y2={VB_H - M.b} stroke={HOME_THEME.red} strokeWidth={1.5} strokeDasharray="4 3" strokeOpacity={0.8} />
      ))}

      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {last && (
        <>
          <circle cx={xAt(last.i)} cy={yAt(last.v)} r={4} fill={color} stroke={HOME_THEME.bg} strokeWidth={2} />
          <text x={xAt(last.i) + 7} y={yAt(last.v) + 3.5} fontSize={10} fontWeight={700} fill={HOME_THEME.text} opacity={0.8}>
            {fmt(last.v)}
          </text>
        </>
      )}

      {hover != null && values[hover] != null && Number.isFinite(values[hover] as number) && (
        <>
          <line x1={xAt(hover)} x2={xAt(hover)} y1={M.t} y2={VB_H - M.b} stroke={HOME_THEME.text} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 3" />
          <circle cx={xAt(hover)} cy={yAt(values[hover] as number)} r={4.5} fill={color} stroke={HOME_THEME.bg} strokeWidth={2} />
        </>
      )}

      <line x1={M.l} x2={VB_W - M.r} y1={VB_H - M.b} y2={VB_H - M.b} stroke={HOME_THEME.border} strokeWidth={1} />
    </svg>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function StrikeHistoryPage() {
  const [days, setDays] = useState<DayMeta[]>([]);
  const [strikes, setStrikes] = useState<StrikeMeta[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  const [dayKey, setDayKey] = useState("");
  const [strike, setStrike] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "success" | "error">("idle");

  const [date, expiry] = dayKey ? dayKey.split("|") : ["", ""];

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
        if (d.length) setDayKey(`${d[0].date}|${d[0].expiry}`);
      } catch (e) { if (alive) setErr(String(e)); }
    })();
    return () => { alive = false; };
  }, []);

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
  const skewCount = useMemo(() => rows.filter((r) => r.skew != null).length, [rows]);

  const stats = useMemo(() => {
    if (!rows.length) return null;
    const g = rows.map((r) => r.netGex);
    const lo = Math.min(...g), hi = Math.max(...g);
    const flips = rows.filter((r, i) => i > 0 && Math.sign(r.netGex) !== Math.sign(rows[i - 1].netGex)).length;
    const vol = rows.map((r) => r.netVolGex).filter((v): v is number => v != null);
    const spots = rows.map((r) => r.spot).filter((v): v is number => v != null);
    const sk = rows.map((r) => r.skew).filter((v): v is number => v != null);
    const lastRow = rows[rows.length - 1];
    return {
      current: g[g.length - 1],
      lo, loAt: hhmm(rows[g.indexOf(lo)].t),
      hi, hiAt: hhmm(rows[g.indexOf(hi)].t),
      flips,
      volFirst: vol[0] ?? null, volLast: vol[vol.length - 1] ?? null,
      spotLo: spots.length ? Math.min(...spots) : null,
      spotHi: spots.length ? Math.max(...spots) : null,
      spotNow: spots.length ? spots[spots.length - 1] : null,
      skewNow: sk.length ? sk[sk.length - 1] : null,
      skewLo: sk.length ? Math.min(...sk) : null,
      skewHi: sk.length ? Math.max(...sk) : null,
      ivK: lastRow.ivK, atmIv: lastRow.atmIv, atmStrike: lastRow.atmStrike,
      skewPct: lastRow.skewPct,
      first: hhmm(rows[0].t), last: hhmm(lastRow.t),
    };
  }, [rows]);

  const label: React.CSSProperties = { fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.green, opacity: 0.7 };
  const value: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: HOME_THEME.text, marginTop: 3, fontVariantNumeric: "tabular-nums" };
  const note: React.CSSProperties = { fontSize: 11, color: HOME_THEME.green, opacity: 0.7, marginTop: 2 };
  const panelTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, display: "flex", alignItems: "center", gap: 8 };
  const panelNote: React.CSSProperties = { fontSize: 11.5, color: HOME_THEME.green, opacity: 0.75, margin: "2px 0 8px" };

  const hoverRow = hover != null ? rows[hover] : null;

  const PanelCard = ({ title, color, subtitle, children }: { title: string; color: string; subtitle: string; children: React.ReactNode }) => (
    <Card variant="classic" padding={18}>
      <div style={panelTitle}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: "inline-block" }} />
        {title}
      </div>
      <div style={panelNote}>{subtitle}</div>
      {children}
    </Card>
  );

  return (
    <PageShell>
      {/* Same treatment as /forward-build: the scanner tab strip renders in link
          mode so this route is not a dead end. */}
      <ScannerTabsBar active="strikehistory" />
      <Card
        variant="classic"
        title="Strike GEX + IV skew history"
        subtitle="One strike, every recorded snapshot. Net GEX is read from the stored column — not recomputed."
        padding={20}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 220 }}>
            <div style={label}>Session · expiry</div>
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
            <div style={label}>Strike</div>
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
              {` · ${skewCount}/${rows.length} with IV`}
            </div>
          )}
        </div>

        {err && <div style={{ marginTop: 12, fontSize: 12, color: HOME_THEME.red }}>{err}</div>}

        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 16 }}>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Current net GEX</div>
              <div style={value}>{fmtM(stats.current)}</div>
              <div style={note}>{stats.last} ET</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Net GEX range</div>
              <div style={value}>{fmtM(stats.lo, 1)} / {fmtM(stats.hi, 1)}</div>
              <div style={note}>low {stats.loAt} · high {stats.hiAt}</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Sign flips</div>
              <div style={value}>{stats.flips}</div>
              <div style={note}>{stats.lo < 0 && stats.hi < 0 ? "short gamma all session" : stats.lo > 0 && stats.hi > 0 ? "long gamma all session" : "crosses zero"}</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Vol-weighted build</div>
              <div style={value}>{fmtM(stats.volFirst, 0)} → {fmtM(stats.volLast, 0)}</div>
              <div style={note}>{stats.volFirst && stats.volLast ? `${(stats.volLast / stats.volFirst).toFixed(1)}×` : "—"}</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Skew vs ATM</div>
              <div style={{ ...value, color: stats.skewNow == null ? HOME_THEME.text : stats.skewNow >= 0 ? LIGHT_BLUE : SOFT_RED }}>
                {fmtVp(stats.skewNow)}{stats.skewNow != null && " vp"}
              </div>
              <div style={note}>
                {stats.skewNow == null ? "no IV recorded yet"
                  : `IV ${fmtIv(stats.ivK)} vs ATM ${fmtIv(stats.atmIv)}${stats.atmStrike != null ? ` @ ${stats.atmStrike}` : ""}`}
              </div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Spot range</div>
              <div style={value}>{stats.spotLo?.toFixed(2) ?? "—"} – {stats.spotHi?.toFixed(2) ?? "—"}</div>
              <div style={note}>now {stats.spotNow?.toFixed(2) ?? "—"}</div>
            </div>
          </div>
        )}

        <div style={{ minHeight: 20, marginTop: 14, fontSize: 12, color: HOME_THEME.text, opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>
          {hoverRow ? (
            <>
              <strong>{hhmm(hoverRow.t)} ET</strong>
              {"  ·  spot "}{hoverRow.spot?.toFixed(2) ?? "—"}
              {"  ·  net GEX "}{fmtM(hoverRow.netGex)}
              {"  ·  vol GEX "}{fmtM(hoverRow.netVolGex, 1)}
              {"  ·  IV "}{fmtIv(hoverRow.ivK)}
              {"  ·  ATM "}{fmtIv(hoverRow.atmIv)}
              {"  ·  skew "}{fmtVp(hoverRow.skew)}{hoverRow.skew != null && " vp"}
              {hoverRow.skewPct != null && `  (${(hoverRow.skewPct * 100).toFixed(1)}%)`}
            </>
          ) : (
            <span style={{ opacity: 0.55 }}>Hover any chart for a synced reading across all four.</span>
          )}
        </div>
      </Card>

      {!rows.length ? (
        <Card variant="classic" padding={24}>
          <div style={{ fontSize: 13, color: HOME_THEME.green, opacity: 0.7, padding: "40px 0", textAlign: "center" }}>
            {strike ? "No snapshots for this strike." : "Pick a session and strike."}
          </div>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "clamp(16px, 2vw, 28px)" }}>
          <PanelCard
            title={`Net GEX at ${strike}`}
            color={HOME_THEME.cyan}
            subtitle="Stored net_gex. Dashed red = GEX stepped while gamma held flat — an OI refresh, not flow."
          >
            <Panel rows={rows} values={rows.map((r) => r.netGex)} color={HOME_THEME.cyan}
              fmt={(v) => fmtM(v, 0)} steps={steps} hover={hover} onHover={setHover} />
          </PanelCard>

          <PanelCard
            title="Net volume-weighted GEX"
            color={HOME_THEME.orange}
            subtitle="net_vol_gex — continuous across OI refreshes, so real intraday accumulation shows here."
          >
            <Panel rows={rows} values={rows.map((r) => r.netVolGex)} color={HOME_THEME.orange}
              fmt={(v) => fmtM(v, 0)} steps={[]} hover={hover} onHover={setHover} />
          </PanelCard>

          <PanelCard
            title="IV skew vs ATM"
            color={LIGHT_BLUE}
            subtitle="IV(K) − IV(ATM) in vol points. ATM = strike nearest spot at each snapshot; IV at both is the call/put average."
          >
            {skewCount === 0 ? (
              <div style={{ fontSize: 12.5, color: HOME_THEME.green, opacity: 0.75, padding: "48px 8px", textAlign: "center", lineHeight: 1.7 }}>
                No IV stored for this session.<br />
                <span style={{ opacity: 0.75 }}>
                  `call_iv` / `put_iv` began recording when this build deployed — the feed always computed them,
                  the writer just never persisted them. Skew fills in from the next snapshot forward, and
                  back-sessions stay blank permanently.
                </span>
              </div>
            ) : (
              <Panel rows={rows} values={rows.map((r) => r.skew)} color={LIGHT_BLUE}
                fmt={(v) => fmtVp(v, 1)} refLine={0} refLabel="flat" steps={[]} hover={hover} onHover={setHover} />
            )}
          </PanelCard>

          <PanelCard
            title="Spot"
            color={HOME_THEME.green}
            subtitle="Dashed line marks the selected strike."
          >
            <Panel rows={rows} values={rows.map((r) => r.spot)} color={HOME_THEME.green}
              fmt={(v) => v.toFixed(0)} refLine={Number.isFinite(strikeNum) ? strikeNum : undefined}
              refLabel={strike} steps={[]} hover={hover} onHover={setHover} />
          </PanelCard>
        </div>
      )}
    </PageShell>
  );
}
