"use client";

// ─────────────────────────────────────────────────────────────────────────────
// GEX Change — Hourly Top 5 (recorded history)
//
// Read-only viewer over gex_change_top: the top 5 "★ Very strong" strikes by
// combined score, captured at the top of every RTH hour by
// server-v2/gex-change-top-recorder.js. One section per hour (most recent
// first), each a ranked 5-row table — so you can scroll back through the day and
// see which strikes were building hardest, hour by hour, without a live tab.
//
// Reads GET /proxy/gex-change-top?date=YYYY-MM-DD (defaults to today).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, homeButtonStyle, classicCardAccentStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

type Row = {
  slot: string; rank: number; symbol: string; expiry: string; strike: number;
  spot: number | null; latest_chg: number | null; pct_open: number | null;
  z_score: number | null; score: number | null; window_min: number;
};
type SlotBucket = { slot: string; ts: string; rows: Row[] };

// Big Δ headline, matching the GEX Change Scanner card ("-8.6M", no $ sign).
const fmtBig = (v: number | null): string => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}B`;
  return `${s}${(a / 1e6).toFixed(1)}M`;
};
const fmtStrike = (v: number): string => (Number.isInteger(v) ? v.toLocaleString("en-US") : String(v));
const fmtSpot = (v: number | null): string => (v == null || !(v > 0) ? "—" : v.toFixed(2));
// "HH:MM" (24h ET) → "H:MM AM/PM ET"
const slotLabel = (slot: string): string => {
  const [hStr, mStr] = slot.split(":");
  const h = Number(hStr);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${mStr ?? "00"} ${ampm} ET`;
};

export default function GexChangeTop() {
  const [slots, setSlots] = useState<SlotBucket[]>([]);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback((d?: string) => {
    setLoading(true); setErr(null);
    const u = new URL("/proxy/gex-change-top", window.location.origin);
    if (d) u.searchParams.set("date", d);
    fetch(u.toString(), { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) { setErr(j?.error || "load failed"); setSlots([]); return; }
        setSlots(j.slots || []);
        setDate(j.date || "");
      })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(date || undefined), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load, date]);

  // ── Screenshot the card (html2canvas, dynamically imported, client-only) ──────
  const cardRef = useRef<HTMLDivElement>(null);
  const [shooting, setShooting] = useState<null | "download" | "copy">(null);

  const capture = useCallback(async (mode: "download" | "copy") => {
    if (!cardRef.current || shooting) return;
    setShooting(mode);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: (HOME_THEME as { bg?: string }).bg || "#0a0e14",
        scale: 2,
        useCORS: true,
        // Exclude the controls row (date picker + buttons) from the image.
        ignoreElements: (el) => (el as HTMLElement).dataset?.noshot === "1",
      });
      const fname = `gex-change-top-${date || "today"}.png`;
      if (mode === "copy" && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await new Promise<void>((resolve, reject) =>
          canvas.toBlob((b) => {
            if (!b) return reject(new Error("no blob"));
            navigator.clipboard.write([new ClipboardItem({ "image/png": b })]).then(resolve, reject);
          }, "image/png"),
        );
      } else {
        const a = document.createElement("a");
        a.download = fname;
        a.href = canvas.toDataURL("image/png");
        a.click();
      }
    } catch (e) {
      // Clipboard blocked or capture failed → fall back to a download.
      try {
        const html2canvas = (await import("html2canvas")).default;
        const canvas = await html2canvas(cardRef.current, {
          backgroundColor: (HOME_THEME as { bg?: string }).bg || "#0a0e14",
          scale: 2, useCORS: true,
          ignoreElements: (el) => (el as HTMLElement).dataset?.noshot === "1",
        });
        const a = document.createElement("a");
        a.download = `gex-change-top-${date || "today"}.png`;
        a.href = canvas.toDataURL("image/png");
        a.click();
      } catch { /* give up silently */ }
    } finally {
      setShooting(null);
    }
  }, [date, shooting]);

  // Per-card capture state so the 📷 gives feedback: idle → busy → "copied"/"saved".
  const [cardState, setCardState] = useState<Record<string, "busy" | "copied" | "saved">>({});

  // Capture a SINGLE pick card to PNG. `node` is the card element; controls inside
  // it are marked data-noshot so they never appear in the image.
  const shotCard = useCallback(async (node: HTMLElement | null, id: string, name: string) => {
    if (!node || cardState[id] === "busy") return;
    setCardState((s) => ({ ...s, [id]: "busy" }));
    let result: "copied" | "saved" = "saved";
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(node, {
        backgroundColor: (HOME_THEME as { bg?: string }).bg || "#0a0e14",
        scale: 2, useCORS: true,
        ignoreElements: (el) => (el as HTMLElement).dataset?.noshot === "1",
      });
      // Try clipboard first, fall back to a download.
      let copied = false;
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        try {
          await new Promise<void>((resolve, reject) =>
            canvas.toBlob((b) => {
              if (!b) return reject(new Error("no blob"));
              navigator.clipboard.write([new ClipboardItem({ "image/png": b })]).then(resolve, reject);
            }, "image/png"),
          );
          copied = true;
        } catch { /* clipboard blocked → download */ }
      }
      if (!copied) {
        const a = document.createElement("a");
        a.download = `${name}.png`;
        a.href = canvas.toDataURL("image/png");
        a.click();
      }
      result = copied ? "copied" : "saved";
    } catch {
      setCardState((s) => { const n = { ...s }; delete n[id]; return n; });
      return;
    }
    setCardState((s) => ({ ...s, [id]: result }));
    setTimeout(() => setCardState((s) => { const n = { ...s }; delete n[id]; return n; }), 1800);
  }, [cardState]);

  return (
   <div ref={cardRef}>
    <Card
      variant="budget"
      title={<span style={{ fontSize: 17 }}>GEX Change · Hourly Top 5</span>}
      subtitle={`★ Very strong picks (|Δ| ≥ $200k & |% vs open| ≥ 30%), ranked by score · captured every 30 min during RTH${loading ? " · refreshing…" : ""}`}
    >
      <div data-noshot="1" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          type="date"
          value={date}
          onChange={(e) => { setDate(e.target.value); load(e.target.value || undefined); }}
          style={{ ...homeButtonStyle, padding: "6px 10px", fontSize: 13, colorScheme: "dark" as CSSProperties["colorScheme"] }}
        />
        <button onClick={() => load(date || undefined)} style={{ ...homeButtonStyle, padding: "6px 12px", fontSize: 13 }}>
          Refresh
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => capture("copy")}
          disabled={shooting !== null}
          style={{ ...homeButtonStyle, padding: "6px 12px", fontSize: 13, opacity: shooting ? 0.6 : 1 }}
        >
          {shooting === "copy" ? "Copying…" : "⧉ Copy image"}
        </button>
        <button
          onClick={() => capture("download")}
          disabled={shooting !== null}
          style={{ ...homeButtonStyle, padding: "6px 12px", fontSize: 13, opacity: shooting ? 0.6 : 1, borderColor: HOME_THEME.orange, color: HOME_THEME.orange }}
        >
          {shooting === "download" ? "Saving…" : "📷 Screenshot"}
        </button>
      </div>

      {err && <div style={{ color: HOME_THEME.red, fontSize: 13, padding: "8px 0" }}>Error: {err}</div>}

      {!err && slots.length === 0 && (
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, padding: "16px 4px" }}>
          {loading ? "Loading…" : "No very-strong picks recorded yet for this date. The recorder captures the top 5 every 30 min during RTH going forward."}
        </div>
      )}

      {slots.map((hb) => (
        <div key={hb.slot} style={{ marginBottom: 22 }}>
          <div data-noshot="1" style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
            <span style={{ color: HOME_THEME.orange, fontWeight: 800, fontSize: 15 }}>{slotLabel(hb.slot)}</span>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{hb.rows.length} pick{hb.rows.length === 1 ? "" : "s"}</span>
          </div>
          <div className="gct-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            {hb.rows.map((r) => {
              const up = (r.latest_chg ?? 0) >= 0;
              const col = up ? HOME_THEME.green : HOME_THEME.red;
              const otmPct = r.spot && r.spot > 0 ? (Math.abs(r.strike - r.spot) / r.spot) * 100 : null;
              const cid = `${r.symbol}-${r.strike}-${hb.slot}`;
              const st = cardState[cid];
              return (
                <div
                  key={`${r.symbol}-${r.expiry}-${r.strike}`}
                  data-card="1"
                  style={{
                    ...classicCardAccentStyle,
                    position: "relative",
                    padding: "12px 14px",
                    background: "rgba(255,209,102,0.10)", // every recorded pick is ★ Very strong
                  }}
                >
                  <button
                    data-noshot="1"
                    onClick={(e) => shotCard((e.currentTarget as HTMLElement).closest("[data-card]") as HTMLElement, cid, `${r.symbol}-${r.strike}-${hb.slot.replace(":", "")}`)}
                    disabled={st === "busy"}
                    title="Screenshot / copy this card"
                    style={{
                      position: "absolute", top: 6, right: 6, cursor: st === "busy" ? "default" : "pointer",
                      border: st ? `1px solid ${st === "busy" ? "rgba(255,255,255,0.2)" : HOME_THEME.green}` : "1px solid transparent",
                      borderRadius: 6, background: st && st !== "busy" ? "rgba(0,0,0,0.35)" : "transparent",
                      fontSize: 12, lineHeight: 1, fontWeight: 700, padding: "3px 6px",
                      color: st === "busy" ? "rgba(255,255,255,0.5)" : st ? HOME_THEME.green : "rgba(255,255,255,0.45)",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}
                  >
                    {st === "busy" ? "…" : st === "copied" ? "✓ Copied" : st === "saved" ? "✓ Saved" : "📷"}
                  </button>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4, paddingRight: 18 }}>
                    <span style={{ fontWeight: 800, fontSize: 17, color: HOME_THEME.text }}>
                      <span style={{ color: "rgba(255,255,255,0.35)", marginRight: 6 }}>{r.rank}</span>{r.symbol}
                    </span>
                    <span style={{ fontSize: 14, color: "rgba(255,255,255,0.6)" }}>{fmtStrike(r.strike)}</span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: col, lineHeight: 1.2 }}>{fmtBig(r.latest_chg)}</div>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
                    {r.expiry} · spot {fmtSpot(r.spot)}
                  </div>
                  <div style={{ display: "flex", gap: 10, fontSize: 14, marginTop: 6, flexWrap: "wrap" }}>
                    {otmPct != null && <span style={{ color: HOME_THEME.orange }}>OTM {otmPct.toFixed(1)}%</span>}
                    <span style={{ color: r.pct_open == null ? "rgba(255,255,255,0.4)" : r.pct_open >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                      {r.pct_open == null ? "—" : `${r.pct_open >= 0 ? "+" : ""}${r.pct_open.toFixed(0)}% vs open`}
                    </span>
                    <span style={{ color: HOME_THEME.cyan }}>score {r.score == null ? "—" : r.score.toFixed(0)}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 14, fontWeight: 800, color: "#FFD166", paddingRight: 78 }}>★ Very strong</div>
                  {/* Brand mark — kept in the screenshot (not data-noshot). */}
                  <img
                    src="/cb-edge-logo.png"
                    alt="CB Edge"
                    style={{ position: "absolute", right: 10, bottom: 8, height: 32, width: "auto", opacity: 0.85, pointerEvents: "none" }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <style>{`
        @media (max-width: 1100px) { .gct-grid { grid-template-columns: repeat(3, 1fr) !important; } }
        @media (max-width: 720px)  { .gct-grid { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 460px)  { .gct-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
        <span>Score = 0.6·|Δ| + 0.4·|% vs open|, normalized 0–100</span>
        <span><span style={{ color: "#FFD166" }}>★ Very strong</span> = |Δ| ≥ $200k AND |% vs open| ≥ 30%</span>
      </div>
    </Card>
   </div>
  );
}
