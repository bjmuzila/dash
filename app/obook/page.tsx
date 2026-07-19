"use client";

import { useEffect, useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, homeInputStyle, homeButtonStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

const BULL = HOME_THEME.green;
const BEAR = HOME_THEME.red;

// ── Data shape ───────────────────────────────────────────────────────────────
// The page renders entirely from an ObookData object. Wire GET /api/obook?ticker=
// to return this shape for any symbol; SAMPLE (QQQ) is the fallback until then.
type Tenor = {
  tag: string; label: string; meta: string; head: string; side: "bull" | "bear";
  rows: [string, string][]; note: string;
};
type Expiry = { date: string; tag: string; val: string; pct: number; dir: 1 | -1 };
type ObookData = {
  ticker: string; date: string; subtitle: string;
  session: string; spot: string; spotChg: string; range: string; prints: string; premium: string;
  readTitle: string; readMeta: string; readBody1: string; readBody2: string;
  metrics: { label: string; value: string; sub: string; tone: "bull" | "bear" | "neutral" | "cyan" | "orange" }[];
  tenors: Tenor[];
  notes: { tone: "cyan" | "orange" | "bull"; t: string; b: string }[];
  expiries: Expiry[];
  curveNote: string; disclaimer: string;
};

const toneColor = (t: string) =>
  t === "bull" ? BULL : t === "bear" ? BEAR : t === "orange" ? HOME_THEME.orange : t === "cyan" ? HOME_THEME.cyan : HOME_THEME.text;

const SAMPLE: ObookData = {
  ticker: "QQQ",
  date: "July 2, 2026",
  subtitle: "Front month (17 Jul) vs intermediate term (Aug–Oct) · time & sales",
  session: "08:30 → 15:14 CT", spot: "725.6 → 712.7", spotChg: "(−12.8)",
  range: "707.7 – 730.5", prints: "5,504", premium: "$168.0M",
  readTitle: "Tenor Split — near-term dip bought, longer-term hedged",
  readMeta: "net mildly long · low conviction",
  readBody1:
    "sold off ~13 points (730→707 low, closing ~712.7). Against that decline, the two tenors diverge sharply — and the split is the signal. Combined premium is put-heavy (0.79× C/P) yet net delta-flow is firmly long (+323K share-equiv), because the front month aggressively bought the dip.",
  readBody2:
    "Front month (17 Jul) is bullish — 1.34× bull/bear, +443K delta: traders bought 725C/730C into the fall and sold the 735 put ($10.3M) and 720 put ($6.4M) — floor-setting for a bounce. Intermediate term (Aug–Oct) is bearish — 0.84×, −120K delta: OTM puts bought (+$5.6M), calls net sold. Read it as fading the selloff for a near-term bounce while adding longer-dated hedges — a tactically-long, strategically-cautious posture.",
  metrics: [
    { label: "Combined C/P Premium", value: "0.79×", sub: "put-heavy tape", tone: "orange" },
    { label: "Combined Delta Flow", value: "+323K", sub: "net long (dip bought)", tone: "bull" },
    { label: "Front-Month Bull/Bear", value: "1.34×", sub: "bullish · +443K delta", tone: "bull" },
    { label: "Interm-Term Bull/Bear", value: "0.84×", sub: "bearish · −120K delta", tone: "bear" },
    { label: "Bounce Floor", value: "720 / 735 P", sub: "$16.7M sold (FM)", tone: "cyan" },
    { label: "Spot Move", value: "−1.8%", sub: "725.6 → 712.7", tone: "bear" },
  ],
  tenors: [
    {
      tag: "FRONT MONTH", label: "FM", meta: "17 Jul 26 · 3,412 prints · $84.8M", head: "BULLISH → DIP-BUYING", side: "bull",
      rows: [["Bull / Bear premium", "1.34×"], ["Delta-weighted flow", "+443K long"], ["OTM call flow", "+$7.55M (bought)"], ["Put flow", "−$5.12M (net sold)"]],
      note: "Bought 725C/730C into the fall; sold the 735 put ($10.3M) and 720 put ($6.4M). A bounce-positioning / floor-setting footprint on the near-term.",
    },
    {
      tag: "INTERMEDIATE TERM", label: "IT", meta: "Aug/Sep/Oct · 2,092 prints · $83.3M", head: "BEARISH → HEDGING", side: "bear",
      rows: [["Bull / Bear premium", "0.84×"], ["Delta-weighted flow", "−120K short"], ["OTM put flow", "+$5.59M (bought)"], ["Call flow", "−$3.40M (net sold)"]],
      note: "Downside protection built further out: 700P/710P/680P bought, calls net sold. Longer-dated hedging against continued weakness.",
    },
  ],
  notes: [
    { tone: "cyan", t: "Why the put-heavy tape is net long", b: "0.79× C/P looks bearish, but the front-month puts are largely sold (floor-setting), not bought — so combined delta-flow is +323K long. On this tape, side of market flips the sign of the raw ratio." },
    { tone: "orange", t: "The structure", b: "Buy the near-term bounce, hedge the back = a tactical-long / strategic-hedge posture. Traders leaning into a snapback after the ~13-pt drop while paying up for protection against the selloff extending into autumn." },
    { tone: "bull", t: "Net lean", b: "Combined +1.07× bull/bear and +323K delta tilt it mildly long — a dip-buy bias for a bounce. But the intermediate hedging caps conviction: this is a bounce-trade footprint, not an all-clear." },
  ],
  expiries: [
    { date: "17 JUL", tag: "FM", val: "+$12.0M", pct: 100, dir: 1 },
    { date: "21 AUG", tag: "IT", val: "−$4.5M", pct: 38, dir: -1 },
    { date: "18 SEP", tag: "IT", val: "−$1.0M", pct: 12, dir: -1 },
    { date: "16 OCT", tag: "IT", val: "−$1.3M", pct: 14, dir: -1 },
  ],
  curveNote:
    "The gradient inverts across the curve: 17 Jul strongly positive (+$12.0M) — the near-term dip-buy — then turning negative through Aug (−$4.5M), Sep 18 (−$1.0M) and Oct (−$1.3M). Flow tilts more bearish the further out you go — the defining feature of today's tape: buy the bounce now, hedge the trend later.",
  disclaimer:
    "Interpretive output only. Aggressor classification is an estimate, not exchange-tagged order flow; deep-ITM calls may be stock substitutes; complex/multi-leg structures (calendars, spreads) may classify per-leg. Not investment advice — for research and discretionary context within an AMT framework.",
};

export default function ObookPage() {
  const initial = useMemo(() => {
    if (typeof window === "undefined") return "QQQ";
    return (new URLSearchParams(window.location.search).get("t") || "QQQ").toUpperCase();
  }, []);
  const [ticker, setTicker] = useState(initial);
  const [input, setInput] = useState(initial);
  const [data, setData] = useState<ObookData>(SAMPLE);
  const [status, setStatus] = useState<"sample" | "loading" | "live" | "error">("sample");

  useEffect(() => {
    let cancel = false;
    setStatus("loading");
    fetch(`/api/obook?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: ObookData) => { if (!cancel) { setData(d); setStatus("live"); } })
      .catch(() => { if (!cancel) { setData({ ...SAMPLE, ticker }); setStatus(ticker === "QQQ" ? "sample" : "error"); } });
    return () => { cancel = true; };
  }, [ticker]);

  const load = () => {
    const t = input.trim().toUpperCase();
    if (!t) return;
    setTicker(t);
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      u.searchParams.set("t", t);
      window.history.replaceState({}, "", u.toString());
    }
  };

  const d = data;

  return (
    <PageShell>
      {/* Header / Combined Read */}
      <Card accent={LIGHT_BLUE}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.18em", color: HOME_THEME.cyan, textTransform: "uppercase" }}>
              NextSignals // Dark Scientific · Order Book Interpretation
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, color: HOME_THEME.text }}>{d.ticker} Order Book — Tenor Split</div>
            <div style={{ fontSize: 14, color: HOME_THEME.green }}>{d.subtitle} · {d.date}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="Ticker…"
              style={{ ...homeInputStyle, width: 110, textTransform: "uppercase", letterSpacing: "0.06em" }}
            />
            <button onClick={load} style={{ ...homeButtonStyle, padding: "8px 14px" }}>Load</button>
            <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: status === "live" ? BULL : status === "error" ? BEAR : HOME_THEME.muted }}>
              {status === "loading" ? "loading…" : status === "live" ? "live" : status === "error" ? "no data" : "sample"}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 28px", marginTop: 16, fontSize: 12, color: HOME_THEME.muted }}>
          <span>SESSION <b style={{ color: HOME_THEME.text }}>{d.session}</b></span>
          <span>SPOT <b style={{ color: HOME_THEME.text }}>{d.spot}</b> <span style={{ color: BEAR }}>{d.spotChg}</span></span>
          <span>RANGE <b style={{ color: HOME_THEME.text }}>{d.range}</b></span>
          <span>PRINTS <b style={{ color: HOME_THEME.text }}>{d.prints}</b></span>
          <span>PREMIUM <b style={{ color: HOME_THEME.text }}>{d.premium}</b></span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) 2.2fr", gap: 28, marginTop: 24 }}>
          <div style={{ borderLeft: `2px solid ${HOME_THEME.cyan}`, paddingLeft: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.16em", color: HOME_THEME.muted, textTransform: "uppercase" }}>Combined Read</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: HOME_THEME.cyan, marginTop: 10, lineHeight: 1.25 }}>{d.readTitle}</div>
            <div style={{ fontSize: 13, color: HOME_THEME.muted, marginTop: 8 }}>{d.readMeta}</div>
          </div>
          <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.65 }}>
            <p style={{ margin: 0 }}><b>{d.ticker}</b> {d.readBody1}</p>
            <p style={{ marginTop: 12, marginBottom: 0 }}>{d.readBody2}</p>
          </div>
        </div>
      </Card>

      {/* Metric tiles */}
      <Card accent={LIGHT_BLUE} padding={0} style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          {d.metrics.map((m, i) => (
            <div key={m.label + i} style={{ padding: 20, borderLeft: i === 0 ? "none" : `1px solid ${HOME_THEME.border}` }}>
              <div style={{ fontSize: 11, letterSpacing: "0.1em", color: HOME_THEME.muted, textTransform: "uppercase" }}>{m.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: toneColor(m.tone), marginTop: 8 }}>{m.value}</div>
              <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 4 }}>{m.sub}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Two tenors */}
      <Card accent={LIGHT_BLUE} title="01 · Two Tenors, Opposite Leans" subtitle="the core finding · front month vs intermediate term">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          {d.tenors.map((c) => {
            const side = c.side === "bull" ? BULL : BEAR;
            return (
              <div key={c.tag} style={{ border: `1px solid ${HOME_THEME.border}`, borderTop: `2px solid ${side}`, borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 12, letterSpacing: "0.1em", color: HOME_THEME.muted }}>
                  <b style={{ color: HOME_THEME.text }}>{c.tag}</b> · {c.meta}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: side, marginTop: 10 }}>{c.head}</div>
                <div style={{ marginTop: 14 }}>
                  {c.rows.map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${HOME_THEME.border}`, fontSize: 13 }}>
                      <span style={{ color: HOME_THEME.muted }}>{k}</span>
                      <span style={{ color: side, fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 14, lineHeight: 1.55 }}>{c.note}</div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 16 }}>
          {d.notes.map((x) => {
            const c = toneColor(x.tone);
            return (
              <div key={x.t} style={{ borderLeft: `2px solid ${c}`, paddingLeft: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.1em", color: c, textTransform: "uppercase", fontWeight: 700 }}>{x.t}</div>
                <div style={{ fontSize: 13, color: HOME_THEME.muted, marginTop: 8, lineHeight: 1.55 }}>{x.b}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Net directional flow by expiry */}
      <Card accent={LIGHT_BLUE} title="02 · Net Directional Flow by Expiry" subtitle="where the lean sits across the curve · ◀ bearish | bullish ▶">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {d.expiries.map((e) => (
            <div key={e.date} style={{ display: "grid", gridTemplateColumns: "120px 1fr 90px", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 13, color: HOME_THEME.text }}>
                {e.date} <span style={{ fontSize: 10, color: HOME_THEME.muted, border: `1px solid ${HOME_THEME.border}`, borderRadius: 3, padding: "1px 5px", marginLeft: 4 }}>{e.tag}</span>
              </div>
              <div style={{ position: "relative", height: 14 }}>
                <div style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: HOME_THEME.border }} />
                <div style={{ position: "absolute", left: e.dir > 0 ? "50%" : undefined, right: e.dir > 0 ? undefined : "50%", height: "100%", width: `${e.pct / 2}%`, borderRadius: 3, background: e.dir > 0 ? BULL : BEAR }} />
              </div>
              <div style={{ fontSize: 13, textAlign: "right", color: e.dir > 0 ? BULL : BEAR, fontWeight: 600 }}>{e.val}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 13, color: HOME_THEME.muted, marginTop: 18, lineHeight: 1.6 }}>{d.curveNote}</div>
        <div style={{ fontSize: 11, color: HOME_THEME.muted, marginTop: 16, lineHeight: 1.55, opacity: 0.75 }}>{d.disclaimer}</div>
      </Card>
    </PageShell>
  );
}
