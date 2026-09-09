import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { DOCK_THEME, HOME_THEME } from "../lib/theme";
import ThemedDatePicker from "./ThemedDatePicker";

// ─────────────────────────────────────────────────────────────────────────────
// THE BOT DROPDOWN — the full composer, in the toolbar.
//
// Third home for this composer, after components/shared/BotAlertPanel.tsx (the
// Next toolbar) and cbedge-v3/src/shell/BotAlertPanel.tsx (the v3 toolbar).
// Same fields, same single POST — a subtly different composer on one surface is
// how the alerts start looking different depending on where they were sent
// from. CHANGE ONE, CHANGE ALL THREE.
//
// This one is the near-twin of the v2 file: owner-vite is inline-styled on the
// same theme module (lib/theme re-exports HOME_THEME/DOCK_THEME), so only the
// import paths and the Next-isms differ. It carries no owner check because
// AuthGate already blocks this entire app for anyone but the owner — and
// /api/bot-alert is the real gate regardless.
//
// Manage is NOT here either: it is a full tab on the BOT page, three feet away.
//
// PORTALED, position:fixed, anchored off a DOMRect — NOT position:absolute. The
// toolbar sets `backdrop-filter`, which creates a stacking context that traps
// absolutely-positioned children inside it.
//
// The panel does not close on send: with several destinations a partial failure
// is normal, and closing on the POST would hide "2 of 4 landed" at exactly the
// moment it matters.
// ─────────────────────────────────────────────────────────────────────────────

type AssetClass = "notes" | "options" | "futures" | "equity";
type TradeAction = "buy" | "sell" | "trim" | "average-down";
type Target = { id: string; label: string; accepts?: Record<string, boolean> };
type SendResult = { id: string; label?: string; ok: boolean; error?: string; warning?: string | null };

const CYAN = HOME_THEME.cyan;
const cyanA = (a: number) => `rgba(33,158,188,${a})`;

const ASSETS: { id: AssetClass; label: string }[] = [
  { id: "options", label: "Options" },
  { id: "futures", label: "Futures" },
  { id: "equity", label: "Equity" },
  { id: "notes", label: "Notes" },
];

const ACTIONS: { id: TradeAction; label: string }[] = [
  { id: "buy", label: "Buy" },
  { id: "sell", label: "Sell" },
  { id: "trim", label: "Trim" },
  { id: "average-down", label: "Avg Down" },
];

/** What the price box IS on this action — the server labels the embed field to
 *  match. "Entry" on a sell reads as an instruction to buy at that price. */
const PRICE_LABEL: Record<TradeAction, string> = {
  buy: "Buy price",
  sell: "Sell price",
  trim: "Trim price",
  "average-down": "Added at",
};

// The bar palette comes from the SERVER (/api/bot-alert/targets → `bars`) and
// the composer sends a bar by NAME. Computing the colour here would silently
// defeat the server's rules — 'auto' on a Note means NO bar at all, which a
// client-side hex cannot express.
type Bar = { id: string; label: string; hex: string };

/** Which fields each class shows. Notes is a plain broadcast — no trade. */
const SHOWS = {
  notes: { trade: false, opt: false },
  options: { trade: true, opt: true },
  futures: { trade: true, opt: false },
  equity: { trade: true, opt: false },
} as const;

const field: CSSProperties = {
  fontSize: 13,
  padding: "7px 9px",
  border: `1px solid ${HOME_THEME.border}`,
  borderRadius: 8,
  background: "rgba(0,0,0,0.30)",
  color: HOME_THEME.text,
  outline: "none",
  minWidth: 0,
};

const label: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: HOME_THEME.text,
};

function pill(on: boolean, accent = CYAN, disabled = false): CSSProperties {
  return {
    padding: "6px 11px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.04em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.35 : 1,
    border: `1px solid ${on ? cyanA(0.55) : HOME_THEME.border}`,
    background: on ? `linear-gradient(180deg, ${cyanA(0.22)}, ${cyanA(0.05)})` : "rgba(255,255,255,0.03)",
    color: on ? accent : HOME_THEME.text,
    transition: "all 0.14s",
  };
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BotAlertPanel({ anchor, close }: { anchor: DOMRect | null; close: () => void }) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [targets, setTargets] = useState<Target[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [assetClass, setAssetClass] = useState<AssetClass>("options");
  const [action, setAction] = useState<TradeAction>("buy");
  const [ticker, setTicker] = useState("");
  const [strike, setStrike] = useState("");
  const [right, setRight] = useState<"call" | "put">("call");
  const [expiry, setExpiry] = useState(todayIso());
  const [price, setPrice] = useState("");
  const [avgPrice, setAvgPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [barChoice, setBarChoice] = useState("auto");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const shows = SHOWS[assetClass];

  useEffect(() => setMounted(true), []);

  // Outside click. The trigger manages its own toggle, so ignore it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (panelRef.current?.contains(t)) return;
      if (t?.closest?.("[data-bot-alert-trigger]")) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [close]);

  // Destinations, and whether each can take the class being composed.
  useEffect(() => {
    let alive = true;
    fetch("/api/bot-alert/targets", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        if (Array.isArray(j?.targets)) setTargets(j.targets);
        if (Array.isArray(j?.bars)) setBars(j.bars);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const accepts = (t: Target) => (t.accepts ? !!t.accepts[assetClass] : true);

  // Switching class can strip a destination of its channel; a selection that
  // silently became unsendable is how an alert goes missing.
  useEffect(() => {
    setPicked((prev) => prev.filter((id) => targets.some((t) => t.id === id && accepts(t))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetClass, targets]);

  // Ctrl+V attaches the clipboard image — the chart is already on the clipboard
  // from TradingView. Only claims the event when the clipboard carries an
  // image, so pasting TEXT into the thesis box still behaves normally.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      readImage(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function readImage(file: File) {
    if (!file.type.startsWith("image/")) return;
    const fr = new FileReader();
    fr.onload = () => setImage(typeof fr.result === "string" ? fr.result : null);
    fr.readAsDataURL(file);
  }

  const canSend = useMemo(() => {
    if (!picked.length || sending) return false;
    return assetClass === "notes" ? notes.trim().length > 0 || image != null : ticker.trim().length > 0;
  }, [picked, sending, assetClass, notes, image, ticker]);

  async function send() {
    if (!canSend) return;
    setSending(true);
    setMsg(null);
    try {
      const r = await fetch("/api/bot-alert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          targets: picked,
          assetClass,
          action,
          ticker: ticker.trim(),
          expiry,
          strike: strike.trim(),
          right,
          price: price.trim(),
          avgPrice: avgPrice.trim(),
          notes: notes.trim(),
          image,
          bar: barChoice,
        }),
      });
      const j = await r.json().catch(() => null);
      const results: SendResult[] = Array.isArray(j?.results) ? j.results : [];

      if (!j?.ok) {
        setMsg({ kind: "err", text: j?.error || results.find((x) => !x.ok)?.error || `Failed (${r.status})` });
        return;
      }

      const failed = results.filter((x) => !x.ok);
      const warned = results.filter((x) => x.ok && x.warning);
      if (failed.length) {
        setMsg({ kind: "err", text: `Sent to ${j.sent}/${j.of} — failed: ${failed.map((f) => f.label || f.id).join(", ")}` });
      } else if (warned.length) {
        // Posted, tag did not resolve. The difference between "the room was
        // notified" and "you think the room was".
        setMsg({ kind: "warn", text: warned[0].warning as string });
      } else {
        setMsg({ kind: "ok", text: `Sent to ${j.sent}/${j.of}` });
      }

      // Clear only what is per-alert. Destinations and asset class survive: the
      // next alert usually goes to the same rooms about the same kind of thing,
      // and re-picking them every time is how one gets forgotten.
      setTicker("");
      setStrike("");
      setPrice("");
      setAvgPrice("");
      setNotes("");
      setImage(null);
    } catch (e) {
      setMsg({ kind: "err", text: String((e as Error)?.message || e) });
    } finally {
      setSending(false);
    }
  }

  if (!mounted) return null;

  const width = 440;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const left = anchor ? Math.max(8, Math.min(anchor.left - width + anchor.width, vw - width - 8)) : 12;
  const top = anchor ? anchor.bottom + 10 : 60;

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      style={{
        position: "fixed",
        top,
        left,
        width,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(100vh - 90px)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: DOCK_THEME.bg,
        border: `1px solid ${HOME_THEME.border}`,
        borderTop: `2px solid ${DOCK_THEME.cyanTop}`,
        borderRadius: 16,
        boxShadow: DOCK_THEME.shadow,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        zIndex: 100000,
        padding: 14,
      }}
    >
      {/* ── Destinations ── */}
      <div style={label}>Broadcast to</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {targets.length === 0 && <span style={{ fontSize: 12, color: HOME_THEME.text }}>No destinations configured.</span>}
        {targets.map((t) => {
          const ok = accepts(t);
          const on = picked.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              disabled={!ok}
              title={ok ? undefined : `No ${assetClass} channel mapped for ${t.label}`}
              onClick={() => setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))}
              style={pill(on, CYAN, !ok)}
            >
              {t.label}
              {!ok && " · none"}
            </button>
          );
        })}
        {targets.length > 1 && (
          <button
            type="button"
            onClick={() => {
              const eligible = targets.filter(accepts).map((t) => t.id);
              setPicked(picked.length === eligible.length ? [] : eligible);
            }}
            style={pill(false)}
          >
            All
          </button>
        )}
      </div>

      {/* ── Asset class ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ASSETS.map((a) => (
          <button key={a.id} type="button" onClick={() => setAssetClass(a.id)} style={pill(assetClass === a.id)}>
            {a.label}
          </button>
        ))}
      </div>

      {/* ── Action ── */}
      {shows.trade && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ACTIONS.map((a) => (
            <button key={a.id} type="button" onClick={() => setAction(a.id)} style={pill(action === a.id)}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Trade details ── */}
      {shows.trade && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="TICKER"
            style={{ ...field, flex: "1 1 110px", fontWeight: 700, letterSpacing: "0.06em" }}
          />
          {shows.opt && (
            <>
              <input
                value={strike}
                onChange={(e) => setStrike(e.target.value)}
                inputMode="decimal"
                placeholder="Strike"
                style={{ ...field, flex: "1 1 80px" }}
              />
              <button
                type="button"
                onClick={() => setRight((r) => (r === "call" ? "put" : "call"))}
                title="Call / Put"
                style={pill(true, right === "call" ? "#3BA55D" : "#ED4245")}
              >
                {right === "call" ? "Call" : "Put"}
              </button>
              {/* Not <input type="date">: that renders the OS calendar, which is
                  white on Windows and cannot be themed. ThemedDatePicker is the
                  app's own month grid and takes the same "YYYY-MM-DD" string. */}
              <div style={{ flex: "1 1 150px", minWidth: 130 }}>
                <ThemedDatePicker value={expiry} onChange={setExpiry} width="100%" />
              </div>
            </>
          )}
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder={PRICE_LABEL[action]}
            style={{ ...field, flex: action === "average-down" ? "1 1 120px" : "2 1 140px" }}
          />
          {action === "average-down" && (
            <input
              value={avgPrice}
              onChange={(e) => setAvgPrice(e.target.value)}
              inputMode="decimal"
              placeholder="New average"
              style={{ ...field, flex: "1 1 120px" }}
            />
          )}
        </div>
      )}

      {/* ── Thesis ── */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder={assetClass === "notes" ? "What should the room know?" : "What's the thesis?"}
        style={{ ...field, width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
      />

      {/* ── Chart ── */}
      {image ? (
        <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: `1px solid ${HOME_THEME.border}` }}>
          <img src={image} alt="" style={{ display: "block", width: "100%", maxHeight: 180, objectFit: "contain" }} />
          <button
            type="button"
            onClick={() => setImage(null)}
            title="Remove chart"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 24,
              height: 24,
              borderRadius: 999,
              cursor: "pointer",
              border: `1px solid ${HOME_THEME.red}`,
              background: "rgba(0,0,0,0.55)",
              color: HOME_THEME.text,
              fontSize: 12,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{
            padding: "14px 10px",
            borderRadius: 10,
            border: `1px dashed ${HOME_THEME.border}`,
            background: "rgba(255,255,255,0.02)",
            color: HOME_THEME.text,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Paste a screenshot (Ctrl+V) · or click to browse
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) readImage(f);
          e.target.value = "";
        }}
      />

      {/* ── Embed bar ── Auto derives it from the action server-side, and gives
          a Note no bar at all. */}
      {bars.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={label}>Bar</span>
          <button type="button" onClick={() => setBarChoice("auto")} style={pill(barChoice === "auto")}>
            Auto
          </button>
          {bars.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              onClick={() => setBarChoice(c.id)}
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                cursor: "pointer",
                padding: 0,
                background: c.hex,
                border: `2px solid ${barChoice === c.id ? HOME_THEME.text : HOME_THEME.border}`,
              }}
            />
          ))}
        </div>
      )}

      {msg && (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            fontSize: 12,
            border: `1px solid ${msg.kind === "ok" ? "#3BA55D" : msg.kind === "warn" ? HOME_THEME.orange : HOME_THEME.red}`,
            background:
              msg.kind === "ok" ? "rgba(59,165,93,0.12)" : msg.kind === "warn" ? "rgba(251,133,1,0.12)" : "rgba(239,68,68,0.12)",
            color: HOME_THEME.text,
          }}
        >
          {msg.text}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={close} style={pill(false)}>
          Close
        </button>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          style={{ ...pill(canSend, CYAN, !canSend), marginLeft: "auto", padding: "8px 16px", fontSize: 12 }}
        >
          {sending ? "Broadcasting…" : "🔔 Broadcast alert"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
