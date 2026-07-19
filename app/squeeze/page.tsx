"use client";

/**
 * /squeeze — SPX/SPY Gamma Exposure + Gamma-Squeeze Screener.
 *
 * Layout mirrors the InsiderFinance "Gamma Exposure" board: a metrics strip
 * (Spot / Net·Call·Put·Total GEX / Call Wall / Put Wall / Zero Gamma), a
 * per-strike gamma profile on the left, and a squeeze-probability screener on
 * the right. Everything is wired to the live desk snapshot at /proxy/gex —
 * the same feed /gex2 polls (symbol, spot, expiry, gexRows, callWall, putWall,
 * gexFlip, updatedAt).
 *
 * Theme: base colors come from HOME_THEME. The green(call)/red(put) directional
 * pair and the meter greens are page-local constants — the same deliberate
 * exception the /owner/budget and /gex2 pages make (LIGHT_BLUE / SOFT_RED).
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED } from "@/components/shared/homeTheme";
import { PageShell } from "@/components/shared/PageCard";
import { useRefreshButton } from "@/hooks/useRefreshButton";

// ── directional accents (page-local, see header note) ────────────────────────
const CALL_GREEN = "#22C55E"; // call / bullish gamma
const PUT_RED = "#F4544E";     // put / bearish gamma
const METER_AMBER = "#F5B301"; // partial-factor meter

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// ── snapshot shape (subset of /proxy/gex) ────────────────────────────────────
type GexRow = {
  strike: number;
  callOI: number;
  putOI: number;
  callGamma: number;
  putGamma: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  callVol?: number;
  putVol?: number;
  dte?: number;
};
type Snapshot = {
  symbol?: string;
  spot?: number;
  expiry?: string;
  gexRows?: GexRow[];
  callWall?: number;
  putWall?: number;
  gexFlip?: number;
  totalNetGex?: number;
  updatedAt?: number;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const fmtPx = (n: number) => (Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
const fmtWall = (n: number) => (Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString()}` : "—");
const fmtInt = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");
const fmtPct = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "—");
function fmtB(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${Math.round(a).toLocaleString()}`;
}

// ── derive every board number from the live snapshot ─────────────────────────
type Factor = { label: string; score: number; max: number };
type Derived = {
  symbol: string;
  spot: number;
  rows: GexRow[];
  callGex: number;
  putGex: number;
  netGex: number;
  totalGex: number;
  ratio: number;
  callOI: number;
  putOI: number;
  callWall: number;
  putWall: number;
  flip: number;
  callWallPct: number;
  putWallPct: number;
  flipPct: number;
  bias: "BULLISH" | "BEARISH";
  score: number;
  status: string;
  factors: Factor[];
  triggerLevel: number;
};

function derive(s: Snapshot): Derived | null {
  const rows = (s.gexRows ?? []).filter((r) => Number.isFinite(r.strike)).slice().sort((a, b) => a.strike - b.strike);
  const spot = num(s.spot);
  if (!rows.length || !(spot > 0)) return null;

  let callGex = 0, netGex = 0, callOI = 0, putOI = 0, callVol = 0, putVol = 0;
  let callGammaOI = 0, putGammaOI = 0;
  for (const r of rows) {
    callGex += num(r.callGEX);
    netGex += num(r.netGEX);
    callOI += num(r.callOI);
    putOI += num(r.putOI);
    callVol += num(r.callVol);
    putVol += num(r.putVol);
    callGammaOI += num(r.callGamma) * num(r.callOI);
    putGammaOI += num(r.putGamma) * num(r.putOI);
  }
  if (Number.isFinite(s.totalNetGex) && s.totalNetGex) netGex = num(s.totalNetGex);
  // Net = Call + Put ⟹ Put = Net − Call (sign-convention agnostic).
  const putGex = netGex - callGex;
  const totalGex = Math.abs(callGex) + Math.abs(putGex);
  const ratio = Math.abs(putGex) > 0 ? Math.abs(callGex) / Math.abs(putGex) : 0;

  const callWall = num(s.callWall);
  const putWall = num(s.putWall);
  const flip = num(s.gexFlip);
  const pct = (lvl: number) => (lvl > 0 ? ((lvl - spot) / spot) * 100 : NaN);

  // ── squeeze scoring ────────────────────────────────────────────────────────
  const shortGamma = netGex < 0; // dealers short gamma → moves amplified
  const proxPut = putWall > 0 ? clamp01(1 - Math.abs(spot - putWall) / (0.03 * spot)) : 0;
  const proxCall = callWall > 0 ? clamp01(1 - Math.abs(spot - callWall) / (0.03 * spot)) : 0;
  const bias: "BULLISH" | "BEARISH" = proxCall > proxPut ? "BULLISH" : "BEARISH";
  const wallProx = bias === "BULLISH" ? proxCall : proxPut;
  const triggerLevel = bias === "BULLISH" ? callWall : putWall;

  // Gamma Regime (25): short-gamma + magnitude vs total book.
  const regime = (shortGamma ? 1 : 0.25) * 25 * clamp01(0.4 + Math.abs(netGex) / Math.max(totalGex, 1));
  // Wall Proximity (25): distance from spot to the tested wall.
  const proxScore = 25 * wallProx;
  // Flow Alignment (20): does gamma$ tilt agree with the bias?
  const pcTilt = callGammaOI > 0 ? putGammaOI / callGammaOI : 1;
  const align = bias === "BEARISH" ? clamp01((pcTilt - 1) / 1.2) : clamp01((1 - pcTilt) / 0.6);
  const flow = 20 * clamp01(0.3 + align);
  // Volume Confirm (20): today's volume turnover vs OI on the tested side.
  const oiSide = bias === "BEARISH" ? putOI : callOI;
  const volSide = bias === "BEARISH" ? putVol : callVol;
  const turnover = oiSide > 0 && volSide > 0 ? clamp01(volSide / oiSide) : 0.4; // no vol field → neutral
  const volume = 20 * clamp01(0.3 + turnover);
  // DEX Bias (10): call/put OI skew in the bias direction.
  const oiSkew = callOI + putOI > 0 ? (callOI - putOI) / (callOI + putOI) : 0;
  const dex = 10 * clamp01(bias === "BULLISH" ? 0.5 + oiSkew : 0.5 - oiSkew);

  const factors: Factor[] = [
    { label: "Gamma Regime", score: Math.round(regime), max: 25 },
    { label: `${bias === "BULLISH" ? "Call" : "Put"} Wall Proximity`, score: Math.round(proxScore), max: 25 },
    { label: "Flow Alignment", score: Math.round(flow), max: 20 },
    { label: "Volume Confirm", score: Math.round(volume), max: 20 },
    { label: "DEX Bias", score: Math.round(dex), max: 10 },
  ];
  const score = Math.max(0, Math.min(100, factors.reduce((a, f) => a + f.score, 0)));
  const status = score >= 70 ? "IMMINENT" : score >= 50 ? "LIKELY" : score >= 30 ? "POSSIBLE" : "UNLIKELY";

  return {
    symbol: s.symbol ?? "SPX",
    spot, rows, callGex, putGex, netGex, totalGex, ratio, callOI, putOI,
    callWall, putWall, flip,
    callWallPct: pct(callWall), putWallPct: pct(putWall), flipPct: pct(flip),
    bias, score, status, factors, triggerLevel,
  };
}

// ── metric tile ──────────────────────────────────────────────────────────────
function Stat({ label, value, sub, subColor, valueColor }: { label: string; value: string; sub?: string; subColor?: string; valueColor?: string }) {
  return (
    <div style={{
      flex: "1 1 0", minWidth: 92, padding: "12px 14px", textAlign: "center",
      borderRight: `1px solid ${HOME_THEME.border}`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: rgba(HOME_THEME.text, 0.55) }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6, color: valueColor ?? HOME_THEME.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10, marginTop: 3, color: subColor ?? rgba(HOME_THEME.text, 0.5) }}>{sub}</div>}
    </div>
  );
}

// ── per-strike gamma profile (SVG) ───────────────────────────────────────────
function StrikeProfile({ d, near }: { d: Derived; near: boolean }) {
  const W = 900, H = 460, padL = 46, padR = 14, padT = 20, padB = 28;
  const all = d.rows;
  const rows = near ? all.filter((r) => Math.abs(r.strike - d.spot) / d.spot <= 0.05) : all;
  const data = (rows.length ? rows : all).filter((r) => Number.isFinite(r.netGEX));
  if (!data.length) return <Empty note="no chain rows" />;

  const maxV = Math.max(...data.map((r) => Math.abs(num(r.netGEX))), 1);
  const xlo = data[0].strike, xhi = data[data.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const mid = padT + (H - padT - padB) / 2;
  const barH = (v: number) => (Math.abs(v) / maxV) * ((H - padT - padB) / 2);
  const barW = Math.max(2, ((W - padL - padR) / data.length) * 0.62);

  const gridVals = [maxV, maxV / 2, 0, -maxV / 2, -maxV];
  const yOf = (v: number) => mid - (v / maxV) * ((H - padT - padB) / 2);

  const ticks: number[] = [];
  const step = Math.max(5, Math.round((xhi - xlo) / 8 / 5) * 5);
  for (let k = Math.ceil(xlo / step) * step; k <= xhi; k += step) ticks.push(k);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yOf(v)} y2={yOf(v)} stroke={HOME_THEME.border} strokeWidth={1} strokeDasharray={v === 0 ? "0" : "3 4"} opacity={v === 0 ? 0.6 : 0.4} />
          <text x={padL - 8} y={yOf(v) + 3} fill={rgba(HOME_THEME.text, 0.5)} fontSize={10} textAnchor="end">
            {v === 0 ? "0.0M" : `${(v / 1e6).toFixed(0)}M`}
          </text>
        </g>
      ))}
      {data.map((r) => {
        const v = num(r.netGEX);
        const isCall = v >= 0;
        const cx = x(r.strike);
        const h = barH(v);
        const y = isCall ? mid - h : mid;
        const isWall = r.strike === d.callWall || r.strike === d.putWall;
        return (
          <rect key={r.strike} x={cx - barW / 2} y={y} width={barW} height={Math.max(0.5, h)}
            fill={isCall ? rgba(CALL_GREEN, 0.9) : rgba(PUT_RED, 0.85)}
            stroke={isWall ? HOME_THEME.text : "none"} strokeWidth={isWall ? 1.5 : 0} rx={1} />
        );
      })}
      {/* spot line */}
      <line x1={x(d.spot)} x2={x(d.spot)} y1={padT - 6} y2={H - padB} stroke={HOME_THEME.cyan} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.9} />
      <text x={x(d.spot)} y={padT - 8} fill={HOME_THEME.cyan} fontSize={11} fontWeight={700} textAnchor="middle">Spot</text>
      {ticks.map((k) => (
        <text key={k} x={x(k)} y={H - padB + 18} fill={rgba(HOME_THEME.text, 0.5)} fontSize={11} textAnchor="middle">{Math.round(k)}</text>
      ))}
    </svg>
  );
}

// ── factor meter row ─────────────────────────────────────────────────────────
function FactorRow({ f }: { f: Factor }) {
  const pct = clamp01(f.score / f.max);
  const color = pct >= 0.75 ? CALL_GREEN : pct >= 0.4 ? METER_AMBER : rgba(HOME_THEME.text, 0.35);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0" }}>
      <div style={{ flex: "0 0 150px", fontSize: 13, color: HOME_THEME.text }}>{f.label}</div>
      <div style={{ flex: 1, height: 8, borderRadius: 6, background: rgba(HOME_THEME.text, 0.08), overflow: "hidden" }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", borderRadius: 6, background: color }} />
      </div>
      <div style={{ flex: "0 0 26px", textAlign: "right", fontSize: 13, fontWeight: 700, color: HOME_THEME.text }}>{f.score}</div>
    </div>
  );
}

function Empty({ note }: { note: string }) {
  return <div style={{ padding: 60, textAlign: "center", fontSize: 13, color: rgba(HOME_THEME.text, 0.5) }}>{note}</div>;
}

const cardBase: CSSProperties = {
  background: HOME_THEME.panelBg,
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  borderRadius: 18,
  border: `1px solid ${HOME_THEME.border}`,
  boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
};

// ── page ─────────────────────────────────────────────────────────────────────
export default function SqueezePage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [near, setNear] = useState(true);

  const load = useCallback(async () => {
    const r = await fetch("/proxy/gex", { cache: "no-store" });
    if (!r.ok) throw new Error(`proxy ${r.status}`);
    setSnap((await r.json()) as Snapshot);
    setErr(null);
  }, []);

  const { trigger, label, style: refreshStyle } = useRefreshButton(load);

  useEffect(() => {
    let alive = true;
    const tick = () => load().catch((e) => { if (alive) setErr(String(e?.message || e)); });
    tick();
    const id = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [load]);

  const d = useMemo(() => (snap ? derive(snap) : null), [snap]);
  const asOf = snap?.updatedAt
    ? new Date(snap.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "—";
  const isBear = d?.bias === "BEARISH";
  const biasColor = isBear ? PUT_RED : CALL_GREEN;

  const toggleBtn = (active: boolean): CSSProperties => ({
    padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${active ? rgba(HOME_THEME.cyan, 0.5) : HOME_THEME.border}`,
    background: active ? rgba(HOME_THEME.cyan, 0.18) : "transparent",
    color: active ? HOME_THEME.cyan : rgba(HOME_THEME.text, 0.6),
  });

  return (
    <PageShell>
      {/* header */}
      <div style={{ ...cardBase, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: HOME_THEME.text }}>{d?.symbol ?? snap?.symbol ?? "SPX"} Gamma Exposure</div>
          <div style={{ fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 8, border: `1px solid ${HOME_THEME.border}`, color: rgba(HOME_THEME.text, 0.7) }}>As of {asOf}</div>
        </div>
        <button style={refreshStyle} onClick={trigger}>{label}</button>
      </div>

      {err && <div style={{ fontSize: 13, color: SOFT_RED }}>Feed error: {err}</div>}
      {!d && !err && <div style={{ ...cardBase, padding: 40 }}><Empty note="waiting on /proxy/gex…" /></div>}

      {d && (
        <>
          {/* metrics strip */}
          <div style={{ ...cardBase, display: "flex", flexWrap: "wrap", padding: 0, overflow: "hidden" }}>
            <Stat label="Spot Price" value={fmtPx(d.spot)} sub={d.symbol} />
            <Stat label="Net GEX" value={fmtB(d.netGex)} sub={`Ratio: ${d.ratio.toFixed(2)}`} valueColor={d.netGex >= 0 ? CALL_GREEN : PUT_RED} />
            <Stat label="Call GEX" value={fmtB(Math.abs(d.callGex))} sub={`${fmtInt(d.callOI)} OI`} valueColor={CALL_GREEN} />
            <Stat label="Put GEX" value={fmtB(-Math.abs(d.putGex))} sub={`${fmtInt(d.putOI)} OI`} valueColor={PUT_RED} />
            <Stat label="Total GEX" value={fmtB(d.totalGex)} sub={`${fmtInt(d.callOI + d.putOI)} OI`} valueColor={HOME_THEME.cyan} />
            <Stat label="Call Wall" value={fmtWall(d.callWall)} sub={fmtPct(d.callWallPct)} subColor={CALL_GREEN} valueColor={CALL_GREEN} />
            <Stat label="Put Wall" value={fmtWall(d.putWall)} sub={fmtPct(d.putWallPct)} subColor={PUT_RED} valueColor={PUT_RED} />
            <Stat label="Zero Gamma" value={fmtWall(d.flip)} sub={fmtPct(d.flipPct)} valueColor={HOME_THEME.cyan} />
          </div>

          {/* main two-column */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
            {/* strike profile */}
            <div style={{ ...cardBase, flex: "2 1 560px", minWidth: 340, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: HOME_THEME.text }}>
                  <span style={{ color: HOME_THEME.cyan }}>▍</span> Strike Profile
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={toggleBtn(!near)} onClick={() => setNear(false)}>⤢ All</button>
                  <button style={toggleBtn(near)} onClick={() => setNear(true)}>⌖ Near</button>
                </div>
              </div>
              <StrikeProfile d={d} near={near} />
              <div style={{ display: "flex", gap: 22, justifyContent: "center", marginTop: 10, fontSize: 12, color: rgba(HOME_THEME.text, 0.7) }}>
                <span><span style={{ display: "inline-block", width: 11, height: 11, background: CALL_GREEN, borderRadius: 2, marginRight: 6 }} />Call Gamma</span>
                <span><span style={{ display: "inline-block", width: 11, height: 11, background: PUT_RED, borderRadius: 2, marginRight: 6 }} />Put Gamma</span>
              </div>
            </div>

            {/* squeeze screener */}
            <div style={{ ...cardBase, flex: "1 1 320px", minWidth: 300, padding: 22 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: HOME_THEME.text }}>Gamma Squeeze Screener</div>
                <div style={{ fontSize: 11, fontWeight: 800, padding: "4px 10px", borderRadius: 6, letterSpacing: "0.06em", color: biasColor, background: rgba(biasColor, 0.14), border: `1px solid ${rgba(biasColor, 0.4)}` }}>{d.bias} BIAS</div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 800, color: biasColor }}>⚡ {isBear ? "Bearish" : "Bullish"} Squeeze</div>
                <div style={{ fontSize: 12, fontWeight: 800, padding: "5px 12px", borderRadius: 20, letterSpacing: "0.05em", color: d.score >= 50 ? CALL_GREEN : rgba(HOME_THEME.text, 0.7), border: `1px solid ${d.score >= 50 ? rgba(CALL_GREEN, 0.5) : HOME_THEME.border}` }}>{d.status}</div>
              </div>

              <div style={{ marginTop: 22 }}>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: rgba(HOME_THEME.text, 0.55) }}>Probability Score</div>
                  <div style={{ fontSize: 34, fontWeight: 800, color: CALL_GREEN }}>{d.score}<span style={{ fontSize: 15, color: rgba(HOME_THEME.text, 0.5) }}>/100</span></div>
                </div>
                <div style={{ height: 8, borderRadius: 6, background: rgba(HOME_THEME.text, 0.08), overflow: "hidden", marginTop: 8 }}>
                  <div style={{ width: `${d.score}%`, height: "100%", borderRadius: 6, background: CALL_GREEN }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10, color: rgba(HOME_THEME.text, 0.45) }}>
                  <span>Unlikely</span><span>Possible</span><span>Likely</span><span>Imminent</span>
                </div>
              </div>

              <div style={{ marginTop: 22 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: rgba(HOME_THEME.text, 0.55), marginBottom: 4 }}>Factor Breakdown</div>
                {d.factors.map((f) => <FactorRow key={f.label} f={f} />)}
              </div>

              <div style={{ marginTop: 20, padding: 16, borderRadius: 12, border: `1px solid ${HOME_THEME.border}`, background: rgba(HOME_THEME.text, 0.02) }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: rgba(HOME_THEME.text, 0.55), marginBottom: 12 }}>Key Levels</div>
                {[
                  { k: "Current Price", v: fmtPx(d.spot), c: HOME_THEME.text, s: "" },
                  { k: `${isBear ? "Put" : "Call"} Wall`, v: fmtWall(d.triggerLevel), c: HOME_THEME.text, s: fmtPct(isBear ? d.putWallPct : d.callWallPct) },
                  { k: "Trigger Level", v: fmtWall(d.triggerLevel), c: METER_AMBER, s: "" },
                ].map((row) => (
                  <div key={row.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: `1px solid ${HOME_THEME.border}` }}>
                    <span style={{ fontSize: 13, color: rgba(HOME_THEME.text, 0.7) }}>{row.k}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: row.c }}>
                      {row.s && <span style={{ fontSize: 11, color: isBear ? PUT_RED : CALL_GREEN, marginRight: 8 }}>({row.s})</span>}
                      {row.v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
