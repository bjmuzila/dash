import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { OWNER_THEME as HOME_THEME, homeShellStyle } from "../lib/theme";
import { ThemedSelect } from "../components/ThemedSelect";
import { shareToDiscord } from "../lib/discord";

// Local calm shell (replaces PageShell's glow background for owner pages).
function PageShell({ children }: { children: ReactNode }) {
  return (
    <div style={homeShellStyle}>
      <main style={{ flex: 1, overflow: "auto", padding: "clamp(14px,2vw,24px)", display: "flex", flexDirection: "column", gap: "clamp(16px,2vw,32px)", minHeight: 0 }}>
        {children}
      </main>
    </div>
  );
}

// All chrome sourced from the shared theme. Data-encoding colors (calls=green,
// puts=red, net=purple, pos/neg) are theme tokens too.
// Budget theme: single light-blue accent + frosted card with a faint light-blue
// radial highlight (no top/accent bars). See BUDGET_UI_STYLE.md.
const C = {
  cyan: "#7dd3fc",
  border: HOME_THEME.border,
  card: HOME_THEME.panelBg,
  label: HOME_THEME.text,
};
const NA = "rgba(255,255,255,0.45)";        // n/a / muted
const POS = HOME_THEME.green;               // positive / calls accent value
const NEG = HOME_THEME.red;                 // negative / puts value
const CALLS = HOME_THEME.green;             // calls row accent
const PUTS = HOME_THEME.red;                // puts row accent
const NET = HOME_THEME.purple;              // net row accent
const WARN = HOME_THEME.orange;             // warn / amber
const VAL = "#CFE6F5";                       // neutral monospace value (count fields)

type ProbeResult = {
  feeds?: Record<string, Record<string, unknown>>;
  exposures?: Record<string, unknown>;
  oiCompare?: Record<string, unknown>;
  [k: string]: unknown;
};

// Combine call + put exposures into one NET row. The server already signs puts
// negative (gex/dex/vex/thetaExp), so call + put = net. spot is shared.
const NET_KEYS = ["gex", "gexVol", "gexOiVol", "dex", "vex", "thetaExp", "vannaExp", "charmExp", "oi", "volume"] as const;
function combineExposures(call?: Record<string, unknown>, put?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!call && !put) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of NET_KEYS) {
    const a = call?.[k];
    const b = put?.[k];
    const an = typeof a === "number" ? a : null;
    const bn = typeof b === "number" ? b : null;
    out[k] = an == null && bn == null ? null : (an ?? 0) + (bn ?? 0);
  }
  out.spot = (typeof call?.spot === "number" ? call.spot : null) ?? (typeof put?.spot === "number" ? put.spot : null);
  return out;
}

// OI+Vol GEX = OI-basis gex + vol-basis gexVol (server signs puts negative on both).
function addOiVol(ex?: Record<string, unknown>) {
  if (!ex) return;
  const g = typeof ex.gex === "number" ? ex.gex : null;
  const gv = typeof ex.gexVol === "number" ? ex.gexVol : null;
  ex.gexOiVol = g == null && gv == null ? null : (g ?? 0) + (gv ?? 0);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 400, color: HOME_THEME.muted, letterSpacing: "0.01em" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, fontFamily: "var(--font-mono)" }}>{children}</div>
    </div>
  );
}

const FEED_ORDER = ["Quote", "Trade", "Summary", "Greeks"] as const;

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  return String(v);
}

// Compact formatter for big exposure numbers (B/M/K), signed.
function fmtExp(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(3)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(2)}`;
}

const EXPOSURE_ROWS: { key: string; label: string }[] = [
  { key: "gexOiVol", label: "GEX (γ·(OI+Vol)·S²)" },
  { key: "dex", label: "DEX (δ·OI·100·S)" },
  { key: "vex", label: "VEX (vega·OI·100·S)" },
  { key: "thetaExp", label: "Theta exp" },
  { key: "gexVol", label: "GEX (vol)" },
  { key: "vannaExp", label: "Vanna exp" },
  { key: "charmExp", label: "Charm exp" },
];

// 5th panel: net-greek exposures for the single contract.
function ExposurePanel({ data }: { data: Record<string, unknown> | undefined; accent?: string }) {
  return (
    <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "14px 18px" }}>
      <div style={{ fontSize: 17, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em", marginBottom: 10 }}>Greeks</div>
      {!data && <div style={{ color: C.label, fontFamily: "var(--font-mono)", fontSize: 14 }}>—</div>}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {EXPOSURE_ROWS.map(({ key, label }) => {
            const v = data[key];
            const na = v == null;
            return (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "var(--font-mono)", fontSize: 14 }}>
                <span style={{ color: C.label }}>{label}</span>
                <span style={{ color: na ? NA : (typeof v === "number" && v < 0 ? NEG : POS), fontWeight: 700 }}>{na ? "n/a" : fmtExp(v)}</span>
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "var(--font-mono)", fontSize: 14, color: C.label, marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
            <span>spot</span><span>{fmt(data.spot)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Section divider label between the call / put / net rows.
function RowLabel({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
      <span style={{ fontSize: 17, fontWeight: 500, color, letterSpacing: "0.01em" }}>{text}</span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

// Row 3: net (call + put) exposures. Same rows as ExposurePanel, plus net OI/vol.
const NET_ROWS: { key: string; label: string }[] = [
  { key: "gexOiVol", label: "Net GEX (γ·(OI+Vol)·S²)" },
  { key: "dex", label: "Net DEX (δ·OI·100·S)" },
  { key: "vex", label: "Net VEX (vega·OI·100·S)" },
  { key: "thetaExp", label: "Net Theta exp" },
  { key: "gexVol", label: "Net GEX (vol)" },
  { key: "vannaExp", label: "Net Vanna exp" },
  { key: "charmExp", label: "Net Charm exp" },
  { key: "oi", label: "Σ OI (call + put)" },
  { key: "volume", label: "Σ Volume (call + put)" },
];
// Screenshot the net card element to a PNG data-URL. Buttons inside the card are
// marked data-html2canvas-ignore so they don't appear in the shot.
async function captureNetCard(el: HTMLElement): Promise<string> {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(el, {
    backgroundColor: HOME_THEME.bg,
    useCORS: true,
    allowTaint: true,
    scale: 2,
    logging: false,
  });
  return canvas.toDataURL("image/png");
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Copy + Discord now share a PNG SCREENSHOT of the net card (not text).
function ShareActions({ targetRef, caption }: { targetRef: React.RefObject<HTMLDivElement | null>; caption: string }) {
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<null | "ok" | "err">(null);

  async function copy() {
    if (!targetRef.current) return;
    try {
      const png = await captureNetCard(targetRef.current);
      const blob = new Blob([dataUrlToBytes(png) as unknown as BlobPart], { type: "image/png" });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard/image unsupported — ignore */ }
  }
  async function share() {
    if (!targetRef.current) return;
    setSending(true); setSent(null);
    try {
      const png = await captureNetCard(targetRef.current);
      await shareToDiscord({ content: caption, image: png, filename: "net-greeks.png" });
      setSent("ok");
    } catch (e) {
      console.error("[owner/dev discord]", e);
      setSent("err");
    }
    finally { setSending(false); setTimeout(() => setSent(null), 2500); }
  }
  const btn: React.CSSProperties = { fontSize: 14, fontWeight: 800, padding: "5px 12px", borderRadius: 7, cursor: "pointer", border: `1px solid ${C.border}`, fontFamily: "inherit", letterSpacing: "0.04em" };
  return (
    <div style={{ display: "flex", gap: 8 }} data-html2canvas-ignore="true">
      <button onClick={copy} style={{ ...btn, background: "#10203033", color: copied ? POS : VAL }}>{copied ? "✓ Copied" : "⧉ Copy img"}</button>
      <button onClick={share} disabled={sending} style={{ ...btn, background: "rgba(255,255,255,0.06)", color: HOME_THEME.text, borderColor: HOME_THEME.borderStrong, opacity: sending ? 0.6 : 1, cursor: sending ? "wait" : "pointer" }}>
        {sending ? "Sending…" : sent === "ok" ? "✓ Sent" : sent === "err" ? "✗ Failed" : "↗ Discord"}
      </button>
    </div>
  );
}

function NetExposurePanel({ data, ticker, strike }: { data: Record<string, unknown> | undefined; ticker: string; strike: string }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const caption = `**Net Greeks · Call + Put** — ${ticker || "?"} · ${strike || "?"}`;
  return (
    <div ref={cardRef} style={{ background: C.card, border: `0.5px solid ${C.border}`, borderLeft: `2px solid ${NET}`, borderRadius: 8, padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Net Greeks · Call + Put</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, fontFamily: "var(--font-mono)", padding: "2px 8px", borderRadius: 6, background: `${NET}1a`, border: `1px solid ${NET}40` }}>{ticker || "?"} · {strike || "?"}</span>
        </div>
        <ShareActions targetRef={cardRef} caption={caption} />
      </div>
      {!data && <div style={{ color: C.label, fontFamily: "var(--font-mono)", fontSize: 14 }}>—</div>}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {NET_ROWS.map(({ key, label }) => {
            const v = data[key];
            const na = v == null;
            const isCount = key === "oi" || key === "volume";
            return (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "var(--font-mono)", fontSize: 14 }}>
                <span style={{ color: C.label }}>{label}</span>
                <span style={{ color: na ? NA : isCount ? VAL : (typeof v === "number" && v < 0 ? NEG : POS), fontWeight: 700 }}>
                  {na ? "n/a" : isCount ? fmt(v) : fmtExp(v)}
                </span>
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "var(--font-mono)", fontSize: 14, color: C.label, marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
            <span>spot</span><span>{fmt(data.spot)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// OI cross-check panel: Theta OPRA OI (authoritative) vs TT REST OI.
function OiComparePanel({ data }: { data: Record<string, unknown> | undefined; accent?: string }) {
  const ok = data?.ok === true;
  const matched = ok && data?.match === true;
  const theta = data?.theta as number | null | undefined;
  const tt = data?.tt as number | null | undefined;
  const diff = data?.diff as number | null | undefined;
  const pct = data?.pctDiff as number | null | undefined;
  const aPct = typeof pct === "number" ? Math.abs(pct) : null;
  const diffColor = aPct == null ? NA : aPct <= 2 ? POS : aPct <= 10 ? WARN : NEG;
  return (
    <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "14px 18px" }}>
      <div style={{ fontSize: 17, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em", marginBottom: 10 }}>OI Check · Theta vs TT REST</div>
      {!data && <div style={{ color: C.label, fontFamily: "var(--font-mono)", fontSize: 14 }}>—</div>}
      {ok && !matched && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontFamily: "var(--font-mono)", fontSize: 14 }}>
          <div style={{ color: WARN }}>Partial — one source missing</div>
          {theta != null && <div style={{ color: C.label }}>Theta OI: <span style={{ color: VAL }}>{fmt(theta)}</span></div>}
          {tt != null && <div style={{ color: C.label }}>TT OI: <span style={{ color: VAL }}>{fmt(tt)}</span></div>}
        </div>
      )}
      {matched && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--font-mono)", fontSize: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: C.label }}>Theta (OPRA)</span><span style={{ color: VAL, fontWeight: 700 }}>{fmt(theta)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: C.label }}>TT REST</span><span style={{ color: VAL, fontWeight: 700 }}>{fmt(tt)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: `1px solid ${C.border}`, paddingTop: 6, marginTop: 2 }}>
            <span style={{ color: C.label }}>Diff (Θ−TT)</span>
            <span style={{ color: diffColor, fontWeight: 800 }}>
              {fmt(diff)}{typeof pct === "number" ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// One feed-type panel: a titled card listing its key/value rows.
function FeedPanel({ name, data }: { name: string; data: Record<string, unknown> | undefined; accent?: string }) {
  // bs* fields are pure-Black-Scholes values added for the Watch tracker's
  // consumption (see proxy-tastytrade.js feeds.Greeks) — hidden here so this
  // probe view keeps showing only the Theta-first merged greeks it always has.
  const entries = data ? Object.entries(data).filter(([k]) => !k.startsWith("bs")) : [];
  return (
    <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "14px 18px" }}>
      <div style={{ fontSize: 17, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em", marginBottom: 10 }}>{name}</div>
      {entries.length === 0 && <div style={{ color: C.label, fontFamily: "var(--font-mono)", fontSize: 14 }}>—</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "var(--font-mono)", fontSize: 14 }}>
            <span style={{ color: C.label }}>{k}</span>
            <span style={{ color: v == null || v === "" ? NA : VAL, fontWeight: 700 }}>{fmt(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Flow GEX raw calc ──────────────────────────────────────────────────────
// Shows the DEALER-INVENTORY flow GEX formula — the one the home page GEX
// chart actually plots (server-v2/computation/gex-calculator.js flowGEX
// branch, fed by FlowGexAccumulator). γ · dealer_net · Spot², dealer_net =
// buyVol − sellVol (dealer's own signed position from the classified tape).
// Dealer long (either leg) = positive contribution, dealer short = negative —
// NO put-side sign flip like the OI-basis GEX above, because the flip is
// already baked into putNet's sign. Inventory comes from the live
// FlowGexAccumulator via /proxy/flow-inventory (not derivable from a single
// REST probe, which only sees today's total volume, not buy/sell split).
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function fmtGamma(v: number | null): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a === 0) return "0";
  return a < 1e-4 ? v.toExponential(3) : v.toFixed(6);
}
function fmtInt(v: number | null): string {
  return v == null ? "—" : Math.round(v).toLocaleString("en-US");
}
function fmtSpot(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function FlowGexCalcPanel({
  call,
  put,
  inv,
}: {
  call: ProbeResult | null;
  put: ProbeResult | null;
  inv: { callBuyVol: number; callSellVol: number; putBuyVol: number; putSellVol: number; callNet: number; putNet: number } | null;
}) {
  const cEx = call?.exposures as Record<string, unknown> | undefined;
  const pEx = put?.exposures as Record<string, unknown> | undefined;
  const cGamma = num((call?.feeds?.Greeks as Record<string, unknown> | undefined)?.gamma);
  const pGamma = num((put?.feeds?.Greeks as Record<string, unknown> | undefined)?.gamma);
  const spot = num(cEx?.spot) ?? num(pEx?.spot);
  const s2 = spot != null ? spot * spot : null;
  const cNet = inv ? inv.callNet : null;
  const pNet = inv ? inv.putNet : null;
  const cFlow = cGamma != null && cNet != null && s2 != null ? cGamma * cNet * s2 : null;
  const pFlow = pGamma != null && pNet != null && s2 != null ? pGamma * pNet * s2 : null;
  const netFlow = cFlow == null && pFlow == null ? null : (cFlow ?? 0) + (pFlow ?? 0);
  // Every column holds a long mono number, so size them to content and let the
  // table scroll sideways instead of wrapping digits onto a second line.
  const cols = "48px minmax(84px, auto) minmax(132px, auto) minmax(88px, auto) minmax(112px, auto) minmax(104px, auto)";
  const head: React.CSSProperties = { color: HOME_THEME.muted, fontSize: 14, fontWeight: 400, textAlign: "right", whiteSpace: "nowrap" };
  const cell: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 14, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  const legs = [
    { tag: "Call", tagColor: CALLS, gamma: cGamma, buy: inv?.callBuyVol ?? null, sell: inv?.callSellVol ?? null, net: cNet, flow: cFlow },
    { tag: "Put", tagColor: PUTS, gamma: pGamma, buy: inv?.putBuyVol ?? null, sell: inv?.putSellVol ?? null, net: pNet, flow: pFlow },
  ];
  return (
    <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderLeft: `2px solid ${WARN}`, borderRadius: 8, padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <span style={{ fontSize: 17, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Flow GEX · raw calc</span>
        <span style={{ fontSize: 14, color: C.label, fontFamily: "var(--font-mono)" }}>γ · dealer_net · Spot²  (dealer long +, short −, no put flip)</span>
      </div>
      <div style={{ fontSize: 14, color: HOME_THEME.muted, marginBottom: 10, fontFamily: "var(--font-mono)" }}>
        dealer-inventory basis (live tape) · Spot {fmtSpot(spot)} · Spot² {fmtInt(s2)} · net = buyVol − sellVol
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 620 }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>
            <span style={{ ...head, textAlign: "left" }}> </span>
            <span style={head}>γ</span>
            <span style={head}>Buy / Sell</span>
            <span style={head}>× Net</span>
            <span style={head}>× S²</span>
            <span style={head}>= Flow GEX</span>
          </div>
          {legs.map((r) => (
            <div key={r.tag} style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", padding: "5px 0" }}>
              <span style={{ color: r.tagColor, fontWeight: 700, fontSize: 14 }}>{r.tag}</span>
              <span style={{ ...cell, color: r.gamma == null ? NA : VAL }}>{fmtGamma(r.gamma == null ? null : Math.abs(r.gamma))}</span>
              <span style={{ ...cell, color: r.buy == null ? NA : VAL, fontSize: 14 }}>{r.buy == null ? "—" : `${fmtInt(r.buy)} / ${fmtInt(r.sell)}`}</span>
              <span style={{ ...cell, color: r.net == null ? NA : r.net < 0 ? NEG : POS }}>{r.net == null ? "n/a" : fmtInt(r.net)}</span>
              <span style={{ ...cell, color: s2 == null ? NA : VAL }}>{fmtInt(s2)}</span>
              <span style={{ ...cell, color: r.flow == null ? NA : r.flow < 0 ? NEG : POS, fontWeight: 700 }}>{r.flow == null ? "n/a" : fmtExp(r.flow)}</span>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", padding: "6px 0 0", borderTop: `1px solid ${C.border}`, marginTop: 2 }}>
            <span style={{ color: NET, fontWeight: 700, fontSize: 14 }}>Net</span>
            <span /><span /><span /><span />
            <span style={{ ...cell, color: netFlow == null ? NA : netFlow < 0 ? NEG : POS, fontWeight: 800 }}>{netFlow == null ? "n/a" : fmtExp(netFlow)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dev() {
  const [ticker, setTicker] = useState("SPXW");
  const [strike, setStrike] = useState("");
  // True until the user edits the strike, so the spot-snap auto-fill doesn't
  // clobber a manually-typed strike.
  const strikeTouched = useRef(false);
  const [expiry, setExpiry] = useState("");
  const [expirations, setExpirations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sentSymbol, setSentSymbol] = useState("");
  const [callResult, setCallResult] = useState<ProbeResult | null>(null);
  const [putResult, setPutResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveMs, setLiveMs] = useState(0);
  // Live dealer inventory (buy/sell net) for the probed strike — same
  // FlowGexAccumulator the WS GEX chart's flowGEX comes from. Distinct from
  // callResult/putResult, which are REST-probed OI/volume/gamma.
  const [flowInv, setFlowInv] = useState<{ callBuyVol: number; callSellVol: number; putBuyVol: number; putSellVol: number; callNet: number; putNet: number } | null>(null);
  const [logs, setLogs] = useState<{ t: number; level: "info" | "ok" | "warn" | "err"; msg: string }[]>([]);

  // Append a timestamped line to the on-page log panel (newest last, capped).
  function log(level: "info" | "ok" | "warn" | "err", msg: string) {
    setLogs((prev) => [...prev, { t: Date.now(), level, msg }].slice(-200));
  }

  // Abort handle for the poll loop + in-flight fetch.
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  function stop() {
    stopRef.current = true;
    abortRef.current?.abort();
    log("warn", "■ stopped by user");
    setStatusMsg("Stopped.");
    setLoading(false);
  }

  // Live "page is alive" counter — ticks up while polling so a stalled tab is obvious.
  useEffect(() => {
    if (!loading) return;
    const start = performance.now();
    setLiveMs(0);
    const id = setInterval(() => setLiveMs(Math.round(performance.now() - start)), 100);
    return () => clearInterval(id);
  }, [loading]);

  // Load available expiries from the proxy (same source the chart uses).
  useEffect(() => {
    fetch("/proxy/expirations")
      .then((r) => r.json())
      .then((d) => {
        const exps: string[] = Array.isArray(d?.expirations) ? d.expirations : [];
        setExpirations(exps);
        if (exps.length && !expiry) setExpiry(d?.expiry || exps[0]);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default the strike to the chain strike closest to live spot (unless the user
  // has already typed one). Uses the same /proxy/gex spot + strikes as the chart.
  useEffect(() => {
    fetch("/proxy/gex")
      .then((r) => r.json())
      .then((d) => {
        if (strikeTouched.current) return;
        const spot = Number(d?.spot);
        if (!(spot > 0)) return;
        const strikes: number[] = Array.isArray(d?.gexRows)
          ? d.gexRows.map((r: { strike: number }) => Number(r.strike)).filter((n: number) => n > 0)
          : [];
        // Nearest real chain strike to spot; fall back to rounding spot itself.
        const nearest = strikes.length
          ? strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best))
          : Math.round(spot);
        setStrike(String(nearest));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tkr = ticker.trim().toUpperCase();

  // All tickers (SPX included) probe via REST — one request, no polling, no
  // dependency on the live feed having the symbol subscribed. This is the path
  // that reliably loads. /proxy/probe-rest does: chain → resolve strike →
  // market-data (quote / OI / volume / prev-close).
  // Probe one side; returns the parsed response (or throws on abort).
  async function probeSide(type: "C" | "P", signal: AbortSignal) {
    const url = `/proxy/probe-rest?ticker=${encodeURIComponent(tkr)}&expiry=${encodeURIComponent(expiry)}&type=${type}&strike=${encodeURIComponent(strike)}`;
    const r = await fetch(url, { signal });
    const d = await r.json();
    return { status: r.status, d };
  }

  async function render() {
    if (!tkr || !expiry || !strike) { setError("Pick a ticker, expiry and strike first."); return; }
    stopRef.current = false;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setLoading(true); setError(null); setCallResult(null); setPutResult(null); setElapsed(null); setStatusMsg(null); setFlowInv(null);
    setSentSymbol("");
    const t0 = performance.now();
    log("info", `▶ REST probe ${tkr} ${strike} ${expiry} (call + put)`);
    try {
      // Fetch both sides at once — one strike in, calls + puts out — plus the
      // live dealer inventory for this strike (real flow-GEX basis, same
      // source the home page GEX chart reads from).
      const [callRes, putRes, invRes] = await Promise.all([
        probeSide("C", signal),
        probeSide("P", signal),
        fetch(`/proxy/flow-inventory?expiry=${encodeURIComponent(expiry)}&strike=${encodeURIComponent(strike)}`, { signal })
          .then((r) => r.json())
          .catch(() => null),
      ]);
      if (invRes?.inventory) {
        const inv = invRes.inventory;
        setFlowInv({
          callBuyVol: Number(inv.callBuyVol ?? 0),
          callSellVol: Number(inv.callSellVol ?? 0),
          putBuyVol: Number(inv.putBuyVol ?? 0),
          putSellVol: Number(inv.putSellVol ?? 0),
          callNet: Number(inv.callNet ?? 0),
          putNet: Number(inv.putNet ?? 0),
        });
      }
      setElapsed(Math.round(performance.now() - t0));

      const sym = callRes.d?.resolvedSymbol || putRes.d?.resolvedSymbol || "";
      if (sym) setSentSymbol(sym);

      const cOk = callRes.d?.found, pOk = putRes.d?.found;
      if (cOk) { addOiVol(callRes.d.result?.exposures); setCallResult(callRes.d.result); }
      if (pOk) { addOiVol(putRes.d.result?.exposures); setPutResult(putRes.d.result); }

      // Log each side.
      for (const [name, res] of [["CALL", callRes], ["PUT", putRes]] as const) {
        const d = res.d;
        if (d?.found) {
          const f = d.result?.feeds || {};
          const ex = d.result?.exposures || {};
          log("ok", `${name} OI=${f?.Summary?.openInterest ?? "—"} vol=${f?.Trade?.volume ?? "—"} GEX=${fmtExp(ex?.gex)} DEX=${fmtExp(ex?.dex)}`);
          const oc = d.result?.oiCompare;
          if (oc?.match) {
            const aPct = typeof oc.pctDiff === "number" ? Math.abs(oc.pctDiff) : null;
            const lvl = aPct == null ? "info" : aPct <= 2 ? "ok" : aPct <= 10 ? "warn" : "err";
            log(lvl, `${name} OI theta=${oc.theta ?? "—"} tt=${oc.tt ?? "—"} diff=${oc.diff ?? "—"}${typeof oc.pctDiff === "number" ? ` (${oc.pctDiff >= 0 ? "+" : ""}${oc.pctDiff.toFixed(1)}%)` : ""}`);
          }
        } else {
          log("warn", `${name} ${res.status} ${d?.status || "?"}`);
        }
      }

      if (cOk || pOk) {
        const cex = cOk ? callRes.d.result?.exposures : undefined;
        const pex = pOk ? putRes.d.result?.exposures : undefined;
        const net = combineExposures(cex, pex);
        log("ok", `Σ NET GEX=${fmtExp(net?.gex)} DEX=${fmtExp(net?.dex)} VEX=${fmtExp(net?.vex)} spot=${net?.spot ?? "—"}`);
        setStatusMsg("REST — calls + puts + net");
      } else {
        // Neither side resolved — surface the most useful error.
        const d = callRes.d?.error || callRes.d?.status ? callRes.d : putRes.d;
        if (d?.error) { setError(d.error); log("err", `✖ ${d.error}`); }
        else if (d?.status === "no-expiry") {
          const av = Array.isArray(d?.availableExpirations) ? d.availableExpirations.join(", ") : "—";
          setError(`No expiry ${expiry} for ${d?.chainTicker || tkr}. Available: ${av}`);
        } else if (d?.status === "no-strike") {
          setError(`Expiry ${expiry} exists but no strikes matched ${strike} for ${d?.chainTicker || tkr}.`);
        } else {
          setStatusMsg(`No data (${d?.status || callRes.status}).`);
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError" && !stopRef.current) {
        const m = String((e as Error)?.message || e);
        setError(m); log("err", `✖ ${m}`);
      }
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = { background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "var(--font-mono)", outline: "none" };

  return (
    <PageShell>
      <div style={{ color: HOME_THEME.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 17, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Dev · Symbol probe</span>
        <span style={{ fontSize: 14, color: C.label }}>Chain → strike resolve → market-data (any ticker)</span>
        <span style={{ fontSize: 14, fontWeight: 500, padding: "2px 8px", borderRadius: 6, background: `${C.cyan}1a`, color: C.cyan, border: `1px solid ${C.border}` }}>REST</span>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 20 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14, color: HOME_THEME.muted, letterSpacing: "0.01em", fontWeight: 400 }}>
          Ticker
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z.]/g, ""))}
            style={{ ...inputStyle, width: 110 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14, color: HOME_THEME.muted, letterSpacing: "0.01em", fontWeight: 400 }}>
          Strike
          <input value={strike} onChange={(e) => { strikeTouched.current = true; setStrike(e.target.value.replace(/[^\d.]/g, "")); }} style={{ ...inputStyle, width: 120 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14, color: HOME_THEME.muted, letterSpacing: "0.01em", fontWeight: 400 }}>
          Expiry
          <ThemedSelect
            value={expiry}
            placeholder="—"
            width={160}
            options={expirations.map((x) => ({ value: x, label: x }))}
            onChange={setExpiry}
          />
        </label>
        <button onClick={render} disabled={loading} style={{ ...inputStyle, cursor: loading ? "wait" : "pointer", background: C.cyan, color: HOME_THEME.bg, fontWeight: 500, padding: "9px 22px", border: "none" }}>
          {loading ? "Loading…" : "Render"}
        </button>
        <button onClick={stop} disabled={!loading} style={{ ...inputStyle, cursor: loading ? "pointer" : "not-allowed", background: loading ? HOME_THEME.red : `${HOME_THEME.red}22`, color: HOME_THEME.text, fontWeight: 500, padding: "9px 22px", border: "none", opacity: loading ? 1 : 0.5 }}>
          ■ Stop
        </button>
      </div>

      {error && <div style={{ color: HOME_THEME.red, fontSize: 14, marginBottom: 14, fontFamily: "var(--font-mono)" }}>{error}</div>}
      {statusMsg && !error && <div style={{ color: loading || statusMsg.startsWith("⚠") ? WARN : C.cyan, fontSize: 14, marginBottom: 14, fontFamily: "var(--font-mono)" }}>{statusMsg}</div>}

      {/* Readout */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        <Field label="Ticker">{tkr || "—"}</Field>
        <Field label="Strike">{strike || "—"}</Field>
        <Field label="Resolved Symbol">{sentSymbol || "—"}</Field>
        <Field label="Elapsed">
          {loading
            ? <span style={{ color: WARN }}>{(liveMs / 1000).toFixed(1)}s ⏱</span>
            : elapsed != null ? `${elapsed} ms` : "—"}
        </Field>
      </div>

      {/* Row 1 — CALL cards */}
      <RowLabel text="Calls" color={CALLS} />
      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12 }}>
        {FEED_ORDER.map((name) => <FeedPanel key={`c-${name}`} name={name} data={callResult?.feeds?.[name]} accent={CALLS} />)}
        <ExposurePanel data={callResult?.exposures} accent={CALLS} />
        <OiComparePanel data={callResult?.oiCompare} accent={CALLS} />
      </div>

      {/* Row 2 — PUT cards */}
      <RowLabel text="Puts" color={PUTS} />
      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12 }}>
        {FEED_ORDER.map((name) => <FeedPanel key={`p-${name}`} name={name} data={putResult?.feeds?.[name]} accent={PUTS} />)}
        <ExposurePanel data={putResult?.exposures} accent={PUTS} />
        <OiComparePanel data={putResult?.oiCompare} accent={PUTS} />
      </div>

      {/* Row 3 — NET (call + put) Greeks */}
      <RowLabel text="Net · Calls + Puts" color={NET} />
      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        <NetExposurePanel data={combineExposures(callResult?.exposures, putResult?.exposures)} ticker={tkr} strike={strike} />
      </div>

      {/* Flow GEX raw calculation (volume basis) */}
      <RowLabel text="Flow GEX · raw calc" color={WARN} />
      {/* Full width — the old auto-fill grid pinned this card to one 360px
          track, which squeezed the number columns into two-line wraps. */}
      <div style={{ marginTop: 8 }}>
        <FlowGexCalcPanel call={callResult} put={putResult} inv={flowInv} />
      </div>

      {/* Raw market-data items — every field, nothing dropped */}
      <details style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "14px 18px", marginTop: 12 }}>
        <summary style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em", cursor: "pointer" }}>Raw response (call + put)</summary>
        <pre style={{ margin: "10px 0 0", fontSize: 14, fontFamily: "var(--font-mono)", color: VAL, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {(callResult || putResult) ? JSON.stringify({ call: callResult, put: putResult }, null, 2) : "—"}
        </pre>
      </details>

      {/* Log panel */}
      <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "14px 18px", marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 17, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Log</div>
          <button onClick={() => setLogs([])} style={{ ...inputStyle, padding: "4px 12px", fontSize: 14, cursor: "pointer" }}>Clear</button>
        </div>
        <div style={{ maxHeight: 240, overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: 14, lineHeight: 1.6, display: "flex", flexDirection: "column" }}>
          {!logs.length && <span style={{ color: C.label }}>—</span>}
          {logs.map((l, i) => {
            const color = l.level === "ok" ? POS : l.level === "warn" ? WARN : l.level === "err" ? HOME_THEME.red : HOME_THEME.text;
            const ts = new Date(l.t).toLocaleTimeString("en-US", { hour12: false }) + "." + String(l.t % 1000).padStart(3, "0");
            return (
              <div key={i} style={{ color, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                <span style={{ color: C.label }}>{ts}</span>  {l.msg}
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </PageShell>
  );
}
