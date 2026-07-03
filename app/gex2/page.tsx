"use client";

/**
 * /gex2 — SPX options "probability + gamma" decode (DTC-Lab style).
 *
 * Styled to the /owner/budget visual language (BUDGET_UI_STYLE.md):
 *   • one accent only — light blue #7dd3fc (no rotating card colors, no top bars)
 *   • reds are always SOFT_RED #f4948e, never #EF4444
 *   • frosted cards with an inner light-blue radial highlight
 * All base colors still source from HOME_THEME; the two page-local constants are
 * the only deliberate non-token hex, exactly as the budget page defines them.
 *
 * Self-contained: polls /proxy/gex and derives EM / max-pain / gamma-flip /
 * put-call balance + implied distribution + per-strike gamma density.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED, dissolveCardStyle } from "@/components/shared/homeTheme";
import { PageShell } from "@/components/shared/PageCard";
import { useRefreshButton } from "@/hooks/useRefreshButton";

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// Dissolve card from the shared theme (see BUDGET_UI_STYLE.md) + page-local layout.
const cardStyle: CSSProperties = {
  ...dissolveCardStyle,
  padding: 24,
  position: "relative",
};
const labelCap: CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: rgba(HOME_THEME.text, 0.75),
};

function BudgetCard({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={cardStyle}>
      {right && <div style={{ position: "absolute", top: 20, right: 20 }}>{right}</div>}
      {(title || subtitle) && (
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={labelCap}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: HOME_THEME.green }}>{subtitle}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// ── snapshot shape (subset of /proxy/gex we use) ────────────────────────────
type GexRow = {
  strike: number;
  callOI: number;
  putOI: number;
  callGamma: number;
  putGamma: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  callIV: number;
  putIV: number;
  dte: number;
};
type Snapshot = {
  symbol?: string;
  spot?: number;
  expiry?: string;
  gexRows?: GexRow[];
  callWall?: number;
  putWall?: number;
  gexFlip?: number;
  updatedAt?: number;
};

const fmt0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");
const fmt2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "—");
const npdf = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

type Derived = {
  spot: number;
  atmIV: number;
  sigma: number;
  emPct: number;
  lo: number;
  hi: number;
  maxPain: number;
  flip: number;
  callWall: number;
  putWall: number;
  pcGamma: number;
  balanceLabel: string;
  balanceNote: string;
};

function derive(s: Snapshot): Derived | null {
  const rows = (s.gexRows ?? []).filter((r) => Number.isFinite(r.strike)).slice().sort((a, b) => a.strike - b.strike);
  const spot = Number(s.spot ?? 0);
  if (!rows.length || !(spot > 0)) return null;

  let atm = rows[0];
  for (const r of rows) if (Math.abs(r.strike - spot) < Math.abs(atm.strike - spot)) atm = r;
  const ivOf = (r: GexRow) => {
    const c = Number(r.callIV) || 0, p = Number(r.putIV) || 0;
    if (c > 0 && p > 0) return (c + p) / 2;
    return c || p || 0;
  };
  let atmIV = ivOf(atm);
  if (!(atmIV > 0)) {
    const near = rows.filter((r) => Math.abs(r.strike - spot) / spot < 0.02).map(ivOf).filter((v) => v > 0);
    if (near.length) atmIV = near.reduce((a, b) => a + b, 0) / near.length;
  }

  const dteDays = Math.max(Number(atm.dte) || 0, 1);
  const t = dteDays / 365;
  const sigma = atmIV > 0 ? atmIV * spot * Math.sqrt(t) : 0;
  const emPct = spot > 0 ? (sigma / spot) * 100 : 0;

  // Max pain — expiry price that minimises total intrinsic payout to holders.
  let maxPain = spot, best = Infinity;
  for (const k of rows) {
    let pain = 0;
    for (const r of rows) {
      if (r.strike < k.strike) pain += (Number(r.callOI) || 0) * (k.strike - r.strike);
      else if (r.strike > k.strike) pain += (Number(r.putOI) || 0) * (r.strike - k.strike);
    }
    if (pain < best) { best = pain; maxPain = k.strike; }
  }

  let callG = 0, putG = 0;
  for (const r of rows) {
    callG += (Number(r.callGamma) || 0) * (Number(r.callOI) || 0);
    putG += (Number(r.putGamma) || 0) * (Number(r.putOI) || 0);
  }
  const pcGamma = callG > 0 ? putG / callG : 0;
  let balanceLabel = "BALANCED", balanceNote = "no directional fear";
  if (pcGamma > 1.5) { balanceLabel = "PUT-HEAVY"; balanceNote = "downside protection bid"; }
  else if (pcGamma > 1.2) { balanceLabel = "PUT-LEAN"; balanceNote = "mild downside hedging"; }
  else if (pcGamma < 0.5) { balanceLabel = "CALL-HEAVY"; balanceNote = "upside/squeeze bid"; }
  else if (pcGamma < 0.7) { balanceLabel = "CALL-LEAN"; balanceNote = "mild upside skew"; }

  return {
    spot, atmIV, sigma, emPct, lo: spot - sigma, hi: spot + sigma,
    maxPain,
    flip: Number(s.gexFlip ?? 0) || 0,
    callWall: Number(s.callWall ?? 0) || 0,
    putWall: Number(s.putWall ?? 0) || 0,
    pcGamma, balanceLabel, balanceNote,
  };
}

// ── stat card ────────────────────────────────────────────────────────────────
function Metric({ label, value, sub, valueColor }: { label: string; value: string; sub: string; valueColor?: string }) {
  return (
    <div style={{
      flex: "1 1 160px", minWidth: 150, padding: "14px 16px", borderRadius: 16,
      border: "none",
      backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
      background: `radial-gradient(circle at 50% 0%, ${rgba(LIGHT_BLUE, 0.07)} 0%, transparent 70%), ${rgba("#0D1119", 0.22)}`,
    }}>
      <div style={labelCap}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: valueColor ?? HOME_THEME.text, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 10, color: rgba(HOME_THEME.text, 0.55), marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ── implied distribution curve (SVG) ────────────────────────────────────────
function DistributionChart({ d }: { d: Derived }) {
  const W = 720, H = 200, padL = 20, padR = 20, padB = 24, padT = 22;
  const { spot, sigma, flip } = d;
  if (!(sigma > 0)) return <Empty note="waiting on ATM IV…" />;
  const lo = spot - 3.2 * sigma, hi = spot + 3.2 * sigma;
  const x = (p: number) => padL + ((p - lo) / (hi - lo)) * (W - padL - padR);
  const N = 160;
  const pts: Array<[number, number]> = [];
  let maxY = 0;
  for (let i = 0; i <= N; i++) {
    const p = lo + (i / N) * (hi - lo);
    const y = npdf((p - spot) / sigma);
    pts.push([p, y]);
    if (y > maxY) maxY = y;
  }
  const yPix = (y: number) => padT + (1 - y / maxY) * (H - padT - padB);
  const area = `M ${x(lo)} ${H - padB} ` + pts.map(([p, y]) => `L ${x(p).toFixed(1)} ${yPix(y).toFixed(1)}`).join(" ") + ` L ${x(hi)} ${H - padB} Z`;
  const line = pts.map(([p, y], i) => `${i === 0 ? "M" : "L"} ${x(p).toFixed(1)} ${yPix(y).toFixed(1)}`).join(" ");

  const band = (lab: string, px: number, color: string, above: boolean) => (
    <g>
      <line x1={px} x2={px} y1={padT} y2={H - padB} stroke={color} strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
      <text x={px} y={above ? padT - 8 : H - padB + 16} fill={color} fontSize={10} fontWeight={700} textAnchor="middle">{lab}</text>
    </g>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 220 }}>
      <defs>
        <linearGradient id="distFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={rgba(LIGHT_BLUE, 0.35)} />
          <stop offset="100%" stopColor={rgba(LIGHT_BLUE, 0.02)} />
        </linearGradient>
      </defs>
      <rect x={x(d.lo)} y={padT} width={Math.max(0, x(d.hi) - x(d.lo))} height={H - padT - padB} fill={rgba(HOME_THEME.green, 0.06)} />
      <path d={area} fill="url(#distFill)" />
      <path d={line} fill="none" stroke={LIGHT_BLUE} strokeWidth={2} />
      <line x1={x(spot)} x2={x(spot)} y1={padT - 4} y2={H - padB} stroke={HOME_THEME.text} strokeWidth={1.25} strokeDasharray="2 3" opacity={0.8} />
      <text x={x(spot)} y={padT - 8} fill={HOME_THEME.text} fontSize={10} fontWeight={800} textAnchor="middle">spot {fmt0(spot)}</text>
      {band(`−1σ ${fmt0(d.lo)}`, x(d.lo), HOME_THEME.green, false)}
      {band(`+1σ ${fmt0(d.hi)}`, x(d.hi), HOME_THEME.green, false)}
      {flip > lo && flip < hi && band(`γ-flip ${fmt0(flip)}`, x(flip), HOME_THEME.orange, true)}
    </svg>
  );
}

// ── gamma density chart (SVG) ───────────────────────────────────────────────
function DensityChart({ rows, d }: { rows: GexRow[]; d: Derived }) {
  const W = 720, H = 210, padL = 20, padR = 20, padB = 26, padT = 18;
  const data = rows.filter((r) => Number.isFinite(r.strike)).slice().sort((a, b) => a.strike - b.strike);
  if (!data.length) return <Empty note="no chain rows" />;
  const lo = d.spot * 0.94, hi = d.spot * 1.06;
  const win = data.filter((r) => r.strike >= lo && r.strike <= hi);
  const shown = win.length > 4 ? win : data;
  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const callAbs = (r: GexRow) => Math.abs(Number(r.callGEX) || (Number(r.callGamma) || 0) * (Number(r.callOI) || 0));
  const putAbs = (r: GexRow) => Math.abs(Number(r.putGEX) || (Number(r.putGamma) || 0) * (Number(r.putOI) || 0));
  let maxV = 0;
  for (const r of shown) { maxV = Math.max(maxV, callAbs(r), putAbs(r)); }
  if (!(maxV > 0)) return <Empty note="no gamma yet" />;
  const barW = Math.max(2, ((W - padL - padR) / shown.length) * 0.42);
  const y0 = H - padB;
  const bar = (v: number) => (v / maxV) * (H - padT - padB);

  const wallLine = (k: number, color: string, lab: string) => k > xlo && k < xhi ? (
    <g>
      <line x1={x(k)} x2={x(k)} y1={padT} y2={y0} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
      <text x={x(k)} y={padT + 10} fill={color} fontSize={10} fontWeight={800} textAnchor="middle">{lab} {fmt0(k)}</text>
    </g>
  ) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 230 }}>
      <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
      {shown.map((r) => {
        const cx = x(r.strike);
        return (
          <g key={r.strike}>
            <rect x={cx - barW} y={y0 - bar(putAbs(r))} width={barW} height={bar(putAbs(r))} fill={rgba(SOFT_RED, 0.75)} />
            <rect x={cx} y={y0 - bar(callAbs(r))} width={barW} height={bar(callAbs(r))} fill={rgba(LIGHT_BLUE, 0.75)} />
          </g>
        );
      })}
      <line x1={x(d.spot)} x2={x(d.spot)} y1={padT} y2={y0} stroke={HOME_THEME.text} strokeWidth={1.25} strokeDasharray="2 3" opacity={0.7} />
      {wallLine(d.putWall, SOFT_RED, "Put wall")}
      {wallLine(d.callWall, LIGHT_BLUE, "Call wall")}
      {d.maxPain > xlo && d.maxPain < xhi && (
        <g>
          <line x1={x(d.maxPain)} x2={x(d.maxPain)} y1={padT} y2={y0} stroke={HOME_THEME.orange} strokeWidth={1.5} strokeDasharray="5 3" opacity={0.9} />
          <text x={x(d.maxPain)} y={y0 - 4} fill={HOME_THEME.orange} fontSize={10} fontWeight={800} textAnchor="middle">Max pain {fmt0(d.maxPain)}</text>
        </g>
      )}
      {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (
        <text key={i} x={x(k)} y={y0 + 16} fill={rgba(HOME_THEME.text, 0.5)} fontSize={10} textAnchor="middle">{fmt0(k)}</text>
      ))}
    </svg>
  );
}

function Empty({ note }: { note: string }) {
  return <div style={{ padding: 40, textAlign: "center", fontSize: 12, color: rgba(HOME_THEME.text, 0.5) }}>{note}</div>;
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function Gex2Page() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/proxy/gex", { cache: "no-store" });
    if (!r.ok) throw new Error(`proxy ${r.status}`);
    const j = (await r.json()) as Snapshot;
    setSnap(j);
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
  const rows = snap?.gexRows ?? [];
  const asOf = snap?.updatedAt ? new Date(snap.updatedAt).toLocaleTimeString() : "—";

  return (
    <PageShell>
      <BudgetCard
        title={`${snap?.symbol ?? "SPX"} · Probability + Gamma`}
        subtitle={d ? `${snap?.expiry ?? ""} expiry · spot ${fmt0(d.spot)} · as of ${asOf}` : "loading live snapshot…"}
        right={<button style={refreshStyle} onClick={trigger}>{label}</button>}
      >
        {err && <div style={{ fontSize: 12, color: SOFT_RED }}>Feed error: {err}</div>}
        {!d && !err && <Empty note="waiting on /proxy/gex…" />}
        {d && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <Metric label="Expected move" value={`±${fmt0(d.sigma)}`} sub={`±${fmt2(d.emPct)}% · ${fmt0(d.lo)}–${fmt0(d.hi)}`} valueColor={LIGHT_BLUE} />
            <Metric label="Max pain" value={fmt0(d.maxPain)} sub="OI-weighted pin" valueColor={HOME_THEME.orange} />
            <Metric label="Gamma flip" value={d.flip ? fmt0(d.flip) : "—"} sub={d.flip && d.spot > d.flip ? "spot above → vol suppressed" : "spot below → vol amplified"} />
            <Metric label="Put / Call γ" value={fmt2(d.pcGamma)} sub={`${d.balanceLabel.toLowerCase()} · gamma$`} valueColor={d.pcGamma > 1.2 ? SOFT_RED : d.pcGamma < 0.7 ? LIGHT_BLUE : HOME_THEME.green} />
          </div>
        )}
      </BudgetCard>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <div style={{ flex: "1 1 380px", minWidth: 320 }}>
          <BudgetCard title="Options → probability" subtitle={d ? `implied distribution from ATM IV ${fmt2(d.atmIV * 100)}%` : ""}>
            {d ? <DistributionChart d={d} /> : <Empty note="—" />}
          </BudgetCard>
        </div>

        <div style={{ flex: "1 1 380px", minWidth: 320 }}>
          <BudgetCard title="Options → gamma density" subtitle={d ? `Density ${d.balanceLabel} (P/C ${fmt2(d.pcGamma)}) — ${d.balanceNote}` : ""}>
            {d ? <DensityChart rows={rows} d={d} /> : <Empty note="—" />}
            {d && (
              <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 11, color: rgba(HOME_THEME.text, 0.7) }}>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: rgba(LIGHT_BLUE, 0.75), borderRadius: 2, marginRight: 6 }} />calls</span>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: rgba(SOFT_RED, 0.75), borderRadius: 2, marginRight: 6 }} />puts</span>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: rgba(HOME_THEME.orange, 0.9), borderRadius: 2, marginRight: 6 }} />max pain</span>
              </div>
            )}
          </BudgetCard>
        </div>
      </div>
    </PageShell>
  );
}
