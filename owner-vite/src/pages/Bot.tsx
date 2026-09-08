import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PageShell, Card } from "../components/PageCard";
import { OWNER_THEME, rgba, homeInputStyle } from "../lib/theme";
import ThemedSelect from "../components/ThemedSelect";
import ThemedDatePicker from "../components/ThemedDatePicker";

/* ────────────────────────────────────────────────────────────────────────────
 * BOT — trade-alert composer for the two Discord bots.
 *
 * UI SHELL ONLY. Nothing here talks to Discord yet: "Broadcast Alert" pushes
 * the composed alert onto local state and it renders in the Activity Feed tab.
 * When the transport is wired, the single place to change is `broadcast()` at
 * the bottom of this file — post `AlertDraft` to the server route and keep the
 * optimistic append. Do NOT scatter fetch calls through the form.
 *
 * The bot names below are placeholders — rename `BOTS` once the two Discord
 * bots are named. `id` is what the server will key on, so pick those
 * deliberately at the same time.
 *
 * Theme: everything sources from lib/theme (OWNER_THEME / homeInputStyle) and
 * the shared PageShell + Card. No hardcoded hex in this file.
 * ════════════════════════════════════════════════════════════════════════════ */

const CYAN = OWNER_THEME.cyan;
const GREEN = OWNER_THEME.green;

// ── The two bots ─────────────────────────────────────────────────────────────
type BotId = "bot-a" | "bot-b";
const BOTS: { id: BotId; label: string; accent: string }[] = [
  { id: "bot-a", label: "Bot 1", accent: CYAN },
  { id: "bot-b", label: "Bot 2", accent: OWNER_THEME.orange },
];

// ── Form vocabulary ──────────────────────────────────────────────────────────
type AssetClass = "notes" | "options" | "futures" | "equity";
type TradeAction = "buy" | "sell" | "trim" | "average-down";
type OptionRight = "call" | "put";

const ACTIONS: { id: TradeAction; label: string; accent: string; bar: string }[] = [
  { id: "buy", label: "Buy", accent: GREEN, bar: "#3BA55D" },
  { id: "sell", label: "Sell", accent: OWNER_THEME.red, bar: "#ED4245" },
  { id: "trim", label: "Trim", accent: OWNER_THEME.gold, bar: "#FAA61A" },
  { id: "average-down", label: "Average Down", accent: CYAN, bar: "#219EBC" },
];

/** The bar Discord will actually draw, given the action and the manual override. */
function resolveBar(action: TradeAction, assetClass: AssetClass, override: string): string {
  if (override !== BAR_AUTO) return BAR_COLORS.find((c) => c.id === override)?.hex ?? "#5865F2";
  if (assetClass === "notes") return "#5865F2"; // a Note is not a trade — blurple, not green
  return ACTIONS.find((a) => a.id === action)?.bar ?? "#219EBC";
}

const RIGHTS: { value: string; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "put", label: "Put" },
];

/**
 * BAR COLOURS — the vertical stripe down the left of a Discord embed is the
 * embed's `color` field, a plain 24-bit int. It is PAYLOAD, not UI chrome, so
 * these hex values are data being sent to Discord and deliberately do not come
 * from lib/theme: they have to read correctly inside Discord's own dark surface,
 * not inside this app.
 *
 * "Auto" is the default and the one to leave alone — it derives the bar from the
 * trade action, so green/red/amber mean the same thing in every post and the
 * room learns to read the stripe before the text. The manual swatches exist for
 * the cases Auto cannot know about: flagging a re-post, colour-coding a series,
 * or a Note that wants to look nothing like a trade.
 */
const BAR_AUTO = "auto";
const BAR_COLORS: { id: string; label: string; hex: string }[] = [
  { id: "green", label: "Green", hex: "#3BA55D" },
  { id: "red", label: "Red", hex: "#ED4245" },
  { id: "amber", label: "Amber", hex: "#FAA61A" },
  { id: "cyan", label: "Cyan", hex: "#219EBC" },
  { id: "blurple", label: "Blurple", hex: "#5865F2" },
  { id: "white", label: "White", hex: "#FFFFFF" },
];

/** Discord wants the bar as an integer, not "#RRGGBB". */
export function barColorInt(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

/** Which fields each asset class shows. Notes is a plain broadcast — no trade. */
const SHOWS = {
  notes: { ticker: false, expiry: false, strike: false, right: false, price: false, action: false },
  options: { ticker: true, expiry: true, strike: true, right: true, price: true, action: true },
  futures: { ticker: true, expiry: false, strike: false, right: false, price: true, action: true },
  equity: { ticker: true, expiry: false, strike: false, right: false, price: true, action: true },
} as const;

// ── Glyph tiles ──────────────────────────────────────────────────────────────
function Glyph({ kind, color }: { kind: AssetClass; color: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "notes") return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
  if (kind === "options") return <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></svg>;
  if (kind === "futures") return <svg {...common}><path d="M3 12h4l3 7 4-14 3 7h4" /></svg>;
  return <svg {...common}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></svg>;
}

const ASSETS: { id: AssetClass; label: string }[] = [
  { id: "notes", label: "Notes" },
  { id: "options", label: "Options" },
  { id: "futures", label: "Futures" },
  { id: "equity", label: "Equity" },
];

// ── Broadcast record ─────────────────────────────────────────────────────────
type BroadcastAlert = {
  id: string;
  at: number;
  bots: BotId[];
  assetClass: AssetClass;
  action: TradeAction;
  ticker: string;
  expiry: string;
  strike: string;
  right: OptionRight;
  price: string;
  notes: string;
  /** Pasted/dropped chart as a data URL. One image, the way the Discord post has one. */
  image: string | null;
  /** Resolved embed bar, "#RRGGBB". Send it as barColorInt(bar). */
  bar: string;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** "SPX 6400C 09/08 @ 2.15" — the one-line form the bot will post. */
function headline(a: BroadcastAlert): string {
  if (a.assetClass === "notes") return "Note";
  const bits: string[] = [ACTIONS.find((x) => x.id === a.action)?.label ?? "", a.ticker.toUpperCase()];
  if (a.assetClass === "options") {
    if (a.strike) bits.push(`${a.strike}${a.right === "call" ? "C" : "P"}`);
    if (a.expiry) bits.push(a.expiry.slice(5).replace("-", "/"));
  }
  if (a.price) bits.push(`@ ${a.price}`);
  return bits.filter(Boolean).join(" ");
}

// ── Small themed primitives ──────────────────────────────────────────────────
const sectionLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: OWNER_THEME.text,
  marginBottom: 10,
};

function Pill({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        transition: "all 0.15s",
        border: `1px solid ${active ? rgba(accent, 0.55) : OWNER_THEME.border}`,
        background: active
          ? `linear-gradient(180deg, ${rgba(accent, 0.22)}, ${rgba(accent, 0.06)})`
          : "rgba(255,255,255,0.03)",
        color: active ? accent : OWNER_THEME.text,
        boxShadow: active ? `0 0 14px ${rgba(accent, 0.2)}` : "none",
      }}
    >
      {children}
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function Bot() {
  const [tab, setTab] = useState<"compose" | "feed">("compose");
  const [feed, setFeed] = useState<BroadcastAlert[]>([]);

  const [bots, setBots] = useState<BotId[]>(["bot-a"]);
  const [assetClass, setAssetClass] = useState<AssetClass>("options");
  const [action, setAction] = useState<TradeAction>("buy");
  const [ticker, setTicker] = useState("");
  const [expiry, setExpiry] = useState(todayIso());
  const [strike, setStrike] = useState("");
  const [right, setRight] = useState<OptionRight>("call");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [barChoice, setBarChoice] = useState<string>(BAR_AUTO);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const shows = SHOWS[assetClass];
  const bar = resolveBar(action, assetClass, barChoice);

  /**
   * Ctrl+V anywhere on the compose tab attaches the clipboard image. This is
   * the whole point of the attach box: the chart is already on the clipboard
   * from TradingView, and making it a file-picker round trip is the difference
   * between posting the chart and not bothering. The listener is on `window`
   * rather than the textarea so a paste lands whether or not a field has focus
   * — and it only takes over when the clipboard actually carries an image, so
   * pasting TEXT into the thesis box still behaves normally.
   */
  useEffect(() => {
    if (tab !== "compose") return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      e.preventDefault();
      readImage(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [tab]);

  function readImage(file: File) {
    if (!file.type.startsWith("image/")) return;
    const fr = new FileReader();
    fr.onload = () => setImage(typeof fr.result === "string" ? fr.result : null);
    fr.readAsDataURL(file);
  }

  const toggleBot = (id: BotId) =>
    setBots((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));

  const canSend = useMemo(() => {
    if (bots.length === 0) return false;
    // A chart on its own is a legitimate Note — the picture IS the post.
    if (assetClass === "notes") return notes.trim().length > 0 || image != null;
    return ticker.trim().length > 0;
  }, [bots, assetClass, notes, ticker, image]);

  /**
   * The ONE place the transport gets wired. Today it only appends locally —
   * when the Discord routes exist, POST the draft here and keep this optimistic
   * append so the feed still updates instantly.
   */
  function broadcast() {
    if (!canSend) return;
    const draft: BroadcastAlert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      bots: [...bots],
      assetClass,
      action,
      ticker: ticker.trim(),
      expiry,
      strike: strike.trim(),
      right,
      price: price.trim(),
      notes: notes.trim(),
      image,
      bar,
    };
    setFeed((prev) => [draft, ...prev]);
    setTicker("");
    setStrike("");
    setPrice("");
    setNotes("");
    setImage(null);
    setTab("feed");
  }

  return (
    <PageShell maxWidth={860}>
      {/* ── Tab switch ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div
          style={{
            display: "inline-flex",
            gap: 4,
            padding: 4,
            borderRadius: 14,
            border: `1px solid ${OWNER_THEME.border}`,
            background: OWNER_THEME.panelInset,
          }}
        >
          {([
            { id: "compose" as const, label: "＋  New Alert", count: 0 },
            { id: "feed" as const, label: "⌁  Activity Feed", count: feed.length },
          ]).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 22px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  border: `1px solid ${active ? rgba(CYAN, 0.3) : "transparent"}`,
                  background: active ? `linear-gradient(180deg, ${rgba(CYAN, 0.16)}, ${rgba(CYAN, 0.04)})` : "transparent",
                  color: active ? CYAN : OWNER_THEME.text,
                }}
              >
                {t.label}
                {t.count > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      padding: "1px 7px",
                      borderRadius: 999,
                      background: rgba(CYAN, 0.16),
                      border: `1px solid ${rgba(CYAN, 0.3)}`,
                      color: CYAN,
                    }}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "compose" ? (
        <Card variant="classic" padding={0}>
          {/* ── Card header ────────────────────────────────────────────── */}
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${OWNER_THEME.border}` }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: OWNER_THEME.text }}>Compose New Alert</div>
            <div style={{ fontSize: 12, color: OWNER_THEME.text, marginTop: 3 }}>
              Select the bot, asset class, and trade parameters.
            </div>
          </div>

          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 22 }}>
            {/* ── Bot toggle ───────────────────────────────────────────── */}
            <div>
              <div style={sectionLabel}>Broadcast To</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {BOTS.map((b) => (
                  <Pill key={b.id} active={bots.includes(b.id)} accent={b.accent} onClick={() => toggleBot(b.id)}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: bots.includes(b.id) ? b.accent : "rgba(255,255,255,0.25)",
                          boxShadow: bots.includes(b.id) ? `0 0 8px ${rgba(b.accent, 0.7)}` : "none",
                        }}
                      />
                      {b.label}
                    </span>
                  </Pill>
                ))}
                <Pill
                  active={bots.length === BOTS.length}
                  accent={OWNER_THEME.lightBlue}
                  onClick={() => setBots(bots.length === BOTS.length ? [] : BOTS.map((b) => b.id))}
                >
                  Both
                </Pill>
              </div>
              {bots.length === 0 && (
                <div style={{ fontSize: 11, color: OWNER_THEME.red, marginTop: 8 }}>
                  Pick at least one bot to broadcast to.
                </div>
              )}
            </div>

            {/* ── Asset class ──────────────────────────────────────────── */}
            <div>
              <div style={sectionLabel}>Asset Class</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                {ASSETS.map((a) => {
                  const active = assetClass === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAssetClass(a.id)}
                      style={{
                        position: "relative",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        padding: "20px 12px",
                        borderRadius: 14,
                        cursor: "pointer",
                        transition: "all 0.15s",
                        border: `1px solid ${active ? rgba(CYAN, 0.45) : OWNER_THEME.border}`,
                        background: active
                          ? `linear-gradient(180deg, ${rgba(CYAN, 0.14)}, ${rgba(CYAN, 0.03)})`
                          : "rgba(255,255,255,0.02)",
                        boxShadow: active ? `0 0 18px ${rgba(CYAN, 0.16)}` : "none",
                      }}
                    >
                      {active && (
                        <span
                          style={{
                            position: "absolute",
                            top: 10,
                            right: 10,
                            width: 6,
                            height: 6,
                            borderRadius: 999,
                            background: CYAN,
                            boxShadow: `0 0 8px ${rgba(CYAN, 0.8)}`,
                          }}
                        />
                      )}
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 38,
                          height: 38,
                          borderRadius: 999,
                          background: active ? rgba(CYAN, 0.14) : "rgba(255,255,255,0.04)",
                        }}
                      >
                        <Glyph kind={a.id} color={active ? CYAN : OWNER_THEME.text} />
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: active ? CYAN : OWNER_THEME.text }}>
                        {a.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Trade action ─────────────────────────────────────────── */}
            {shows.action && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 14,
                  border: `1px solid ${OWNER_THEME.border}`,
                  background: OWNER_THEME.panelInset,
                }}
              >
                <div style={sectionLabel}>Trade Action</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {ACTIONS.map((a) => (
                    <Pill key={a.id} active={action === a.id} accent={a.accent} onClick={() => setAction(a.id)}>
                      {a.label}
                    </Pill>
                  ))}
                </div>
              </div>
            )}

            {/* ── Trade details ────────────────────────────────────────── */}
            {(shows.ticker || shows.price) && (
              <div>
                <div style={sectionLabel}>Trade Details</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {shows.ticker && (
                    <input
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase())}
                      placeholder="TICKER"
                      style={{ ...homeInputStyle, flex: "1 1 150px", minWidth: 130, letterSpacing: "0.08em", fontWeight: 700 }}
                    />
                  )}
                  {shows.expiry && <ThemedDatePicker value={expiry} onChange={setExpiry} width={190} />}
                  {shows.strike && (
                    <input
                      value={strike}
                      onChange={(e) => setStrike(e.target.value)}
                      inputMode="decimal"
                      placeholder="Strike"
                      style={{ ...homeInputStyle, flex: "0 1 130px", minWidth: 110 }}
                    />
                  )}
                  {shows.right && (
                    <div style={{ flex: "0 1 140px", minWidth: 120 }}>
                      <ThemedSelect value={right} options={RIGHTS} onChange={(v) => setRight(v as OptionRight)} ariaLabel="Call or Put" />
                    </div>
                  )}
                </div>
                {shows.price && (
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    inputMode="decimal"
                    placeholder="$  Entry / Exit Price"
                    style={{ ...homeInputStyle, width: "100%", marginTop: 12 }}
                  />
                )}
              </div>
            )}

            {/* ── Reasoning ────────────────────────────────────────────── */}
            <div>
              <div style={sectionLabel}>Analysis / Reasoning</div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder={assetClass === "notes" ? "What do you want the room to know?" : "What's the thesis for this trade?"}
                style={{ ...homeInputStyle, width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
              />
            </div>

            {/* ── Chart ────────────────────────────────────────────────── */}
            <div>
              <div style={sectionLabel}>Chart</div>
              {image ? (
                <div
                  style={{
                    position: "relative",
                    borderRadius: 14,
                    overflow: "hidden",
                    border: `1px solid ${OWNER_THEME.border}`,
                    background: OWNER_THEME.panelInset,
                  }}
                >
                  <img src={image} alt="Attached chart" style={{ display: "block", width: "100%", maxHeight: 340, objectFit: "contain" }} />
                  <button
                    type="button"
                    onClick={() => setImage(null)}
                    title="Remove chart"
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: 800,
                      lineHeight: 1,
                      border: `1px solid ${rgba(OWNER_THEME.red, 0.45)}`,
                      background: rgba(OWNER_THEME.red, 0.18),
                      color: OWNER_THEME.text,
                      backdropFilter: "blur(8px)",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) readImage(f);
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "28px 16px",
                    borderRadius: 14,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    border: `1px dashed ${dragOver ? rgba(CYAN, 0.6) : OWNER_THEME.borderStrong}`,
                    background: dragOver ? rgba(CYAN, 0.08) : "rgba(255,255,255,0.02)",
                  }}
                >
                  <span style={{ fontSize: 20 }}>🖼︎</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: dragOver ? CYAN : OWNER_THEME.text }}>
                    Paste a screenshot (Ctrl+V)
                  </span>
                  <span style={{ fontSize: 11, color: OWNER_THEME.text }}>or drop a file here · or click to browse</span>
                </div>
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
            </div>

            {/* ── Embed bar ────────────────────────────────────────────── */}
            <div>
              <div style={sectionLabel}>Embed Bar Colour</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setBarChoice(BAR_AUTO)}
                  title="Derive the bar from the trade action"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 14px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    border: `1px solid ${barChoice === BAR_AUTO ? rgba(CYAN, 0.55) : OWNER_THEME.border}`,
                    background:
                      barChoice === BAR_AUTO
                        ? `linear-gradient(180deg, ${rgba(CYAN, 0.22)}, ${rgba(CYAN, 0.06)})`
                        : "rgba(255,255,255,0.03)",
                    color: barChoice === BAR_AUTO ? CYAN : OWNER_THEME.text,
                  }}
                >
                  <span style={{ width: 4, height: 14, borderRadius: 2, background: bar }} />
                  Auto
                </button>

                {BAR_COLORS.map((c) => {
                  const on = barChoice === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setBarChoice(c.id)}
                      title={c.label}
                      aria-label={c.label}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        cursor: "pointer",
                        padding: 0,
                        transition: "all 0.15s",
                        border: `2px solid ${on ? c.hex : OWNER_THEME.border}`,
                        background: on ? rgba(CYAN, 0.06) : "rgba(255,255,255,0.02)",
                        boxShadow: on ? `0 0 12px ${c.hex}55` : "none",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <span style={{ width: 5, height: 16, borderRadius: 2, background: c.hex }} />
                    </button>
                  );
                })}

                <span style={{ fontSize: 11, color: OWNER_THEME.text, fontVariantNumeric: "tabular-nums" }}>
                  {bar} · {barColorInt(bar)}
                </span>
              </div>
            </div>

            {/* ── Send ─────────────────────────────────────────────────── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingTop: 18,
                borderTop: `1px solid ${OWNER_THEME.border}`,
              }}
            >
              <div style={{ fontSize: 12, color: OWNER_THEME.text, fontVariantNumeric: "tabular-nums" }}>
                {bots.length === 0
                  ? "No bot selected"
                  : `→ ${BOTS.filter((b) => bots.includes(b.id)).map((b) => b.label).join(" + ")}`}
              </div>
              <button
                type="button"
                onClick={broadcast}
                disabled={!canSend}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "12px 24px",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 800,
                  letterSpacing: "0.02em",
                  cursor: canSend ? "pointer" : "not-allowed",
                  border: `1px solid ${rgba(CYAN, canSend ? 0.5 : 0.15)}`,
                  background: canSend
                    ? `linear-gradient(180deg, ${rgba(CYAN, 0.3)}, ${rgba(CYAN, 0.08)})`
                    : "rgba(255,255,255,0.03)",
                  color: canSend ? CYAN : OWNER_THEME.text,
                  boxShadow: canSend ? `0 0 20px ${rgba(CYAN, 0.22)}` : "none",
                  transition: "all 0.15s",
                }}
              >
                <span style={{ fontSize: 15 }}>🔔</span> Broadcast Alert
              </button>
            </div>
          </div>
        </Card>
      ) : (
        /* ── Activity feed ──────────────────────────────────────────────── */
        <Card variant="classic" padding={0}>
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${OWNER_THEME.border}` }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: OWNER_THEME.text }}>Activity Feed</div>
            <div style={{ fontSize: 12, color: OWNER_THEME.text, marginTop: 3 }}>
              Alerts composed this session. Not persisted — the transport is not wired yet.
            </div>
          </div>

          {feed.length === 0 ? (
            <div style={{ padding: "56px 24px", textAlign: "center", fontSize: 13, color: OWNER_THEME.text }}>
              Nothing broadcast yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {feed.map((a) => {
                // The feed row wears the SAME bar the Discord embed will get, so
                // what you see here is what the room sees.
                const accent = a.bar;
                return (
                  <div
                    key={a.id}
                    style={{
                      display: "flex",
                      gap: 14,
                      padding: "16px 24px",
                      borderLeft: `4px solid ${accent}`,
                      borderBottom: `1px solid ${OWNER_THEME.border}`,
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 36,
                        height: 36,
                        borderRadius: 999,
                        border: `1px solid ${rgba(accent, 0.3)}`,
                        background: rgba(accent, 0.1),
                      }}
                    >
                      <Glyph kind={a.assetClass} color={accent} />
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: accent }}>{headline(a)}</span>
                        {BOTS.filter((b) => a.bots.includes(b.id)).map((b) => (
                          <span
                            key={b.id}
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              padding: "2px 8px",
                              borderRadius: 999,
                              border: `1px solid ${rgba(b.accent, 0.3)}`,
                              background: rgba(b.accent, 0.1),
                              color: b.accent,
                            }}
                          >
                            {b.label}
                          </span>
                        ))}
                        <span style={{ marginLeft: "auto", fontSize: 11, color: OWNER_THEME.text }}>{ago(a.at)}</span>
                      </div>
                      {a.notes && (
                        <div style={{ fontSize: 13, color: OWNER_THEME.text, marginTop: 6, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                          {a.notes}
                        </div>
                      )}
                      {a.image && (
                        <img
                          src={a.image}
                          alt="Chart"
                          style={{
                            display: "block",
                            marginTop: 10,
                            maxWidth: "100%",
                            maxHeight: 260,
                            borderRadius: 12,
                            border: `1px solid ${OWNER_THEME.border}`,
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </PageShell>
  );
}
