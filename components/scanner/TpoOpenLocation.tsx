"use client";
import { useMemo } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import type { TpoResult, TpoSession, TpoStructure } from "@/lib/tpo";
import { KIND_TITLE } from "@/lib/tpo";
import type { EsCandle } from "@/hooks/useEsCandles";

// RTH open vs previous values — the open-type read (Dalton), NOT an IB forecast.
// Where does today's actual RTH open (and current price) sit relative to prior
// value: above prior VAH, inside prior value, or below prior VAL — plus prior
// week value and the open (unfinished) naked levels. Available at 09:30, because
// it conditions on the OPEN and PRIOR structure, nothing that needs the IB.

type Props = { res: TpoResult; spot: number | null; candles: EsCandle[] };

const RTH_OPEN = 9 * 60 + 30, RTH_CLOSE = 16 * 60;
function etMin(ts: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ts));
  return Number(p.find((x) => x.type === "hour")?.value) * 60 + Number(p.find((x) => x.type === "minute")?.value);
}
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay();               // 0 Sun … 6 Sat
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function mergeVA(sessions: TpoSession[]): { poc: number; vah: number; val: number; high: number; low: number } | null {
  const m = new Map<number, number>();
  for (const s of sessions) for (const b of s.bins) m.set(b.price, (m.get(b.price) || 0) + b.count);
  const bins = [...m.entries()].map(([price, count]) => ({ price, count })).sort((a, b) => a.price - b.price);
  if (bins.length < 3) return null;
  let poc = 0; for (let i = 1; i < bins.length; i++) if (bins[i].count > bins[poc].count) poc = i;
  const total = bins.reduce((s, b) => s + b.count, 0), target = total * 0.7;
  let lo = poc, hi = poc, acc = bins[poc].count;
  while (acc < target && (lo > 0 || hi < bins.length - 1)) {
    const bel = lo > 0 ? bins[lo - 1].count : -1, ab = hi < bins.length - 1 ? bins[hi + 1].count : -1;
    if (ab >= bel) { hi++; acc += Math.max(0, ab); } else { lo--; acc += Math.max(0, bel); }
  }
  return { poc: bins[poc].price, vah: bins[hi].price, val: bins[lo].price, high: bins[bins.length - 1].price, low: bins[0].price };
}
const midS = (s: TpoStructure) => (s.priceLo + s.priceHi) / 2;

export default function TpoOpenLocation({ res, spot, candles }: Props) {
  const title = <span style={{ fontSize: 17, color: HOME_THEME.orange }}>RTH open vs previous values</span>;

  const data = useMemo(() => {
    if (!candles.length || res.sessions.length < 2) return null;
    const latestDate = candles[candles.length - 1]?.date;
    if (!latestDate) return null;
    // today's RTH open (first 09:30–16:00 bar on the latest date), if the session has opened
    const openBar = candles.find((c) => c.date === latestDate && etMin(c.timestamp) >= RTH_OPEN && etMin(c.timestamp) < RTH_CLOSE);
    const openPx = openBar?.open ?? null;
    // prior COMPLETED session = last built session strictly before the latest date
    const prior = [...res.sessions].reverse().find((s) => s.date < latestDate) ?? null;
    if (!prior) return null;
    // prior week value = sessions in the calendar week before the latest date's week
    const wkMon = mondayOf(latestDate);
    const pw = res.sessions.filter((s) => s.date < wkMon && s.date >= mondayOf(new Date(new Date(`${wkMon}T00:00:00Z`).getTime() - 7 * 864e5).toISOString().slice(0, 10)));
    const week = mergeVA(pw);
    // nearest OPEN (unfinished) naked/poor levels above & below the open anchor
    const anchor = openPx ?? spot ?? prior.poc;
    const opens = res.open.filter((s) => (s.kind === "naked_poc" || s.kind === "poor_high" || s.kind === "poor_low") && s.ageSessions >= 1);
    const nkUp = opens.filter((s) => midS(s) > anchor).sort((a, b) => midS(a) - midS(b))[0] ?? null;
    const nkDn = opens.filter((s) => midS(s) < anchor).sort((a, b) => midS(b) - midS(a))[0] ?? null;
    return { openPx, prior, week, nkUp, nkDn, anchor };
  }, [res, spot, candles]);

  if (!data) return <Card variant="budget" title={title}><div style={{ padding: 16, color: HOME_THEME.text, fontSize: 14 }}>Waiting on RTH candles.</div></Card>;

  const { openPx, prior, week, nkUp, nkDn } = data;
  const O = openPx;
  const loc = (vah: number, val: number) => O == null ? null : O > vah ? "above" : O < val ? "below" : "inside";
  const dLoc = loc(prior.vah, prior.val);

  const tone = dLoc === "above" ? HOME_THEME.green : dLoc === "below" ? HOME_THEME.red : LIGHT_BLUE;
  const banner = O == null ? "Prior RTH session hasn't opened yet"
    : dLoc === "inside" ? "Open INSIDE prior value"
    : dLoc === "above" ? "Open ABOVE prior value"
    : "Open BELOW prior value";
  const lean = O == null ? "Levels below are prior session values — the open read fills in at 09:30 ET."
    : dLoc === "inside" ? "Rotational / balanced lean. Two-sided trade likely inside prior value; the pd VAH/VAL edges are fade zones back toward pd POC. Break-and-accept beyond an edge flips to the outside-value case."
    : dLoc === "above" ? "Higher open. If price ACCEPTS above pd VAH (holds, builds value) → trend up, target the open levels above. If it REJECTS back below pd VAH → failed auction, rotate down toward pd POC / into prior value."
    : "Lower open. If price ACCEPTS below pd VAL (holds, builds value) → trend down, target the open levels below. If it REJECTS back above pd VAL → failed auction, rotate up toward pd POC / into prior value.";

  const Ref = ({ label, px, color }: { label: string; px: number | null | undefined; color?: string }) => {
    if (px == null) return null;
    const rel = O == null ? null : O - px;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${HOME_THEME.text}12` }}>
        <span style={{ fontSize: 12, color: HOME_THEME.text + "CC", minWidth: 118 }}>{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 13, minWidth: 62, color: color ?? HOME_THEME.text }}>{px.toFixed(2)}</span>
        {rel != null && (
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12, fontWeight: 700, color: rel >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
            open {rel >= 0 ? "+" : ""}{rel.toFixed(2)}
          </span>
        )}
      </div>
    );
  };

  return (
    <Card variant="budget" title={title}
      subtitle={`${O != null ? `open ${O.toFixed(2)} · ` : ""}${spot != null ? `spot ${spot.toFixed(2)} · ` : ""}vs prior day + prior week + open levels`}>

      <div style={{ background: `${tone}14`, border: `1px solid ${tone}55`, borderRadius: 10, padding: "11px 14px", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: tone, letterSpacing: ".01em" }}>{banner}</div>
        <div style={{ fontSize: 12.5, color: HOME_THEME.text, marginTop: 4, lineHeight: 1.55 }}>{lean}</div>
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: HOME_THEME.text + "AA", fontWeight: 700, marginBottom: 2 }}>Prior day ({prior.date})</div>
          <Ref label="pd high" px={prior.high} />
          <Ref label="pd VAH" px={prior.vah} color={LIGHT_BLUE} />
          <Ref label="pd POC" px={prior.poc} color={HOME_THEME.orange} />
          <Ref label="pd VAL" px={prior.val} color={LIGHT_BLUE} />
          <Ref label="pd low" px={prior.low} />
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: HOME_THEME.text + "AA", fontWeight: 700, marginBottom: 2 }}>Prior week &amp; open levels</div>
          {week ? (<>
            <Ref label="pw VAH" px={week.vah} color={LIGHT_BLUE} />
            <Ref label="pw POC" px={week.poc} color={HOME_THEME.orange} />
            <Ref label="pw VAL" px={week.val} color={LIGHT_BLUE} />
          </>) : <div style={{ fontSize: 12, color: HOME_THEME.text + "88", padding: "6px 0" }}>No prior-week value.</div>}
          <Ref label={nkUp ? `↑ ${KIND_TITLE[nkUp.kind].split(" — ")[0]}` : "↑ open level"} px={nkUp ? midS(nkUp) : null} color={HOME_THEME.green} />
          <Ref label={nkDn ? `↓ ${KIND_TITLE[nkDn.kind].split(" — ")[0]}` : "↓ open level"} px={nkDn ? midS(nkDn) : null} color={HOME_THEME.red} />
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 11.5, color: HOME_THEME.text + "99", lineHeight: 1.5 }}>
        &quot;open ±&quot; = where the RTH open printed relative to each level. Prior-week value merges the prior calendar week&apos;s RTH profiles; open levels are the nearest unfinished naked POC / poor high-low above and below.
      </div>
    </Card>
  );
}
