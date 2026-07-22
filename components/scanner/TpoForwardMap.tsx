"use client";
import { useMemo } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import {
  baseRateFor, KIND_TITLE, KIND_MEANING,
  type TpoResult, type TpoStructure, type StructureKind,
} from "@/lib/tpo";

// TPO forward map — the forecast layer on top of the structures engine.
//
// buildTpoStructures already tags every auction structure and forward-fills it
// across later sessions; `res.open` is everything still UNFINISHED (never
// repaired). This card ranks that open business against live spot into a plain
// "what should price do next, in each direction" read:
//
//   • poor high / poor low  → unfinished auction, EXPECT it taken out → a TARGET
//   • naked POC             → untested fair value → a MAGNET
//   • excess high / low     → rejection that held → SUPPORT / RESISTANCE (fade)
//   • tail high / low       → trend leg → continuation level (don't fade)
//   • hole                  → thin zone → price ACCELERATES through (never a target)
//
// Each row carries the kind's base-rate test probability at its age bucket, so a
// 2-day-old poor high (very likely to be revisited) is not read like a 4-week-old
// one. The base rate is a prior on the TYPE, not a promise for that price.

type Props = { res: TpoResult; spot: number | null };

const mid = (s: TpoStructure) => (s.priceLo + s.priceHi) / 2;

// role of each structure in a forward map
const ROLE: Record<StructureKind, { tag: string; tone: "target" | "magnet" | "hold" | "thru" }> = {
  poor_high: { tag: "target", tone: "target" },
  poor_low: { tag: "target", tone: "target" },
  naked_poc: { tag: "magnet", tone: "magnet" },
  excess_high: { tag: "resistance", tone: "hold" },
  excess_low: { tag: "support", tone: "hold" },
  tail_high: { tag: "continuation", tone: "hold" },
  tail_low: { tag: "continuation", tone: "hold" },
  hole: { tag: "accelerant", tone: "thru" },
};

const toneColor = (t: "target" | "magnet" | "hold" | "thru") =>
  t === "target" ? HOME_THEME.orange
  : t === "magnet" ? LIGHT_BLUE
  : t === "hold" ? HOME_THEME.green
  : HOME_THEME.red;

export default function TpoForwardMap({ res, spot }: Props) {
  const title = <span style={{ fontSize: 17, color: HOME_THEME.orange }}>TPO forward map — unfinished business vs spot</span>;

  const { above, below, leadUp, leadDn } = useMemo(() => {
    const open = res.open.filter((s) => s.ageSessions >= 1); // give it ≥1 session to resolve
    const px = spot ?? 0;
    const withRate = (s: TpoStructure) => {
      const br = baseRateFor(res, s.kind, s.ageSessions);
      return { s, m: mid(s), br };
    };
    const up = open.filter((s) => mid(s) > px).map(withRate).sort((a, b) => a.m - b.m);
    const dn = open.filter((s) => mid(s) < px).map(withRate).sort((a, b) => b.m - a.m);
    // "lead" = nearest actionable directional level (a target or magnet), each side
    const lead = (rows: typeof up) => rows.find((r) => ROLE[r.s.kind].tone === "target" || ROLE[r.s.kind].tone === "magnet") ?? rows[0];
    return { above: up.slice(0, 5), below: dn.slice(0, 5), leadUp: lead(up), leadDn: lead(dn) };
  }, [res, spot]);

  if (spot == null) {
    return <Card variant="budget" title={title}>
      <div style={{ padding: 16, color: HOME_THEME.text, fontSize: 14 }}>Waiting on spot.</div>
    </Card>;
  }
  const px: number = spot;

  const Row = ({ r }: { r: { s: TpoStructure; m: number; br: { rate: number | null; n: number; scope: string } } }) => {
    const role = ROLE[r.s.kind];
    const col = toneColor(role.tone);
    const dist = Math.abs(r.m - px);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${HOME_THEME.text}14` }}>
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 13.5, minWidth: 62, color: HOME_THEME.text }}>
          {r.m.toFixed(2)}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: col, background: `${col}1A`, border: `1px solid ${col}55`, borderRadius: 5, padding: "2px 7px", minWidth: 78, textAlign: "center" }}>
          {role.tag}
        </span>
        <span style={{ fontSize: 12.5, color: HOME_THEME.text, flex: 1, minWidth: 0 }}>
          {KIND_TITLE[r.s.kind]} · {r.s.ageSessions}d
        </span>
        <span title="base-rate test probability for this kind at this age" style={{ fontVariantNumeric: "tabular-nums", fontSize: 12.5, fontWeight: 700, minWidth: 42, textAlign: "right", color: r.br.rate == null ? HOME_THEME.text + "88" : r.br.rate >= 0.6 ? HOME_THEME.green : r.br.rate >= 0.4 ? HOME_THEME.orange : HOME_THEME.red }}>
          {r.br.rate == null ? "—" : `${Math.round(r.br.rate * 100)}%`}
        </span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11.5, color: HOME_THEME.text + "99", minWidth: 44, textAlign: "right" }}>
          {`${dist.toFixed(0)}p`}
        </span>
      </div>
    );
  };

  const leanText = () => {
    const up = leadUp ? `${ROLE[leadUp.s.kind].tag} ${leadUp.m.toFixed(2)} (${KIND_TITLE[leadUp.s.kind].split(" — ")[0]})` : "—";
    const dn = leadDn ? `${ROLE[leadDn.s.kind].tag} ${leadDn.m.toFixed(2)} (${KIND_TITLE[leadDn.s.kind].split(" — ")[0]})` : "—";
    return { up, dn };
  };
  const lean = leanText();

  return (
    <Card variant="budget" title={title}
      subtitle={`spot ${spot.toFixed(2)} · ${res.sessions.length} sessions · open business only · base rate = prior on the type, not this price`}>

      {/* headline lean */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 220, background: `${HOME_THEME.green}12`, border: `1px solid ${HOME_THEME.green}44`, borderRadius: 8, padding: "9px 12px" }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: HOME_THEME.green, fontWeight: 700, marginBottom: 3 }}>↑ next above</div>
          <div style={{ fontSize: 13.5, color: HOME_THEME.text }}>{lean.up}</div>
        </div>
        <div style={{ flex: 1, minWidth: 220, background: `${HOME_THEME.red}12`, border: `1px solid ${HOME_THEME.red}44`, borderRadius: 8, padding: "9px 12px" }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: HOME_THEME.red, fontWeight: 700, marginBottom: 3 }}>↓ next below</div>
          <div style={{ fontSize: 13.5, color: HOME_THEME.text }}>{lean.dn}</div>
        </div>
      </div>

      {/* ladders */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 300 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: HOME_THEME.text + "AA", fontWeight: 700, margin: "6px 0 2px" }}>Above spot</div>
          {above.length ? above.map((r) => <Row key={r.s.id} r={r} />) : <div style={{ fontSize: 12.5, color: HOME_THEME.text + "88", padding: "8px 0" }}>No open structure above.</div>}
        </div>
        <div style={{ flex: 1, minWidth: 300 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: HOME_THEME.text + "AA", fontWeight: 700, margin: "6px 0 2px" }}>Below spot</div>
          {below.length ? below.map((r) => <Row key={r.s.id} r={r} />) : <div style={{ fontSize: 12.5, color: HOME_THEME.text + "88", padding: "8px 0" }}>No open structure below.</div>}
        </div>
      </div>

      {/* legend / meaning */}
      <div style={{ marginTop: 12, fontSize: 12, color: HOME_THEME.text, lineHeight: 1.6, borderTop: `1px solid ${HOME_THEME.text}14`, paddingTop: 10 }}>
        <b style={{ color: HOME_THEME.orange }}>target</b> {KIND_MEANING.poor_high.split(" — ")[1]} ·{" "}
        <b style={{ color: LIGHT_BLUE }}>magnet</b> untested fair value, pulls price in ·{" "}
        <b style={{ color: HOME_THEME.green }}>support/resistance</b> rejection that held, fade back ·{" "}
        <b style={{ color: HOME_THEME.red }}>accelerant</b> thin zone, price runs through — never a target.
      </div>
    </Card>
  );
}
