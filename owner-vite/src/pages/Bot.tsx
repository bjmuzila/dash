import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PageShell, Card } from "../components/PageCard";
import { OWNER_THEME, rgba, homeInputStyle } from "../lib/theme";
import ThemedSelect from "../components/ThemedSelect";
import ThemedDatePicker from "../components/ThemedDatePicker";
import BotManage from "./BotManage";
import BotScheduled from "./BotScheduled";

/* ────────────────────────────────────────────────────────────────────────────
 * BOT — trade-alert composer. One post, fanned out to several Discord servers.
 *
 * ONE TRANSPORT CALL, in `broadcast()`. Everything else here is form state. Do
 * NOT scatter fetch calls through the fields.
 *
 * DESTINATIONS ARE SERVER-OWNED. GET /api/bot-alert/targets returns the enabled
 * Discords and, per asset class, whether each one has a channel mapped for it —
 * `accepts`. A destination that cannot take the class you are composing is
 * DISABLED here rather than left selectable, because the alternative is finding
 * out from a red row in the feed after the other three already posted. Webhook
 * URLs never reach this file; the Manage tab edits them by id through masked
 * values. `FALLBACK_TARGETS` is only what renders before that route answers.
 *
 * Theme: everything sources from lib/theme (OWNER_THEME / homeInputStyle) and
 * the shared PageShell + Card. No hardcoded hex in this file.
 * ════════════════════════════════════════════════════════════════════════════ */

const CYAN = OWNER_THEME.cyan;
const GREEN = OWNER_THEME.green;

// ── Destinations ─────────────────────────────────────────────────────────────
type Target = {
  id: string;
  label: string;
  accent: string;
  /** Per-class routability from the server. null = unknown (pre-fetch fallback). */
  accepts: Record<string, boolean> | null;
};

/** Accents cycle so each destination keeps one colour across the whole page. */
const TARGET_ACCENTS = [CYAN, OWNER_THEME.orange, OWNER_THEME.gold, OWNER_THEME.lightBlue, GREEN];

/** Shown until /api/bot-alert/targets answers. Placeholder names on purpose. */
const FALLBACK_TARGETS: Target[] = ["Discord 1", "Discord 2", "Discord 3", "Discord 4"].map((label, i) => ({
  id: `discord-${i + 1}`,
  label,
  accent: TARGET_ACCENTS[i % TARGET_ACCENTS.length],
  accepts: null,
}));

/** A destination with no channel for this class cannot be sent to. */
function accepts(t: Target, cls: AssetClass): boolean {
  return t.accepts ? !!t.accepts[cls] : true;
}

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

/** What the price box IS on this action — the server labels the embed field to
 *  match. "Entry" on a sell reads as an instruction to buy at that price. */
const PRICE_LABEL: Record<TradeAction, string> = {
  buy: "Buy price",
  sell: "Sell price",
  trim: "Trim price",
  "average-down": "Added at",
};

/** The bar Discord will actually draw, given the action and the manual override. */
function resolveBar(action: TradeAction, assetClass: AssetClass, override: string): string {
  if (override !== BAR_AUTO) return BAR_COLORS.find((c) => c.id === override)?.hex ?? "#5865F2";
  // A Note on Auto gets NO bar — the server omits `color` entirely. The stripe
  // is how a trade reads as a trade at a glance; analysis having one dilutes it.
  if (assetClass === "notes") return "";
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
  /** Destination ids, as the server keys them. */
  bots: string[];
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
  /** Per-destination outcome from the server. Empty until the POST answers. */
  results: SendResult[];
};

type SendResult = { id: string; label?: string; ok: boolean; error?: string; warning?: string | null; messageId?: string | null };

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
  disabled = false,
  title,
}: {
  active: boolean;
  accent: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: "8px 16px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
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
  const [tab, setTab] = useState<"compose" | "feed" | "manage" | "scheduled">("compose");
  const [feed, setFeed] = useState<BroadcastAlert[]>([]);

  const [targets, setTargets] = useState<Target[]>(FALLBACK_TARGETS);
  const [bots, setBots] = useState<string[]>([]);
  const [assetClass, setAssetClass] = useState<AssetClass>("options");
  const [action, setAction] = useState<TradeAction>("buy");
  const [ticker, setTicker] = useState("");
  const [expiry, setExpiry] = useState(todayIso());
  const [strike, setStrike] = useState("");
  const [right, setRight] = useState<OptionRight>("call");
  const [price, setPrice] = useState("");
  const [avgPrice, setAvgPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [barChoice, setBarChoice] = useState<string>(BAR_AUTO);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
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

  /**
   * Destination list, server-owned. A 404 here is the EXPECTED state until the
   * route exists — fall back rather than blanking the composer, because a page
   * that cannot be used at all is a worse failure than placeholder names.
   */
  const [targetsNonce, setTargetsNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/bot-alert/targets", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        type Row = { id: string; label?: string; accepts?: Record<string, boolean> };
        const rows: Target[] = Array.isArray(j?.targets)
          ? j.targets
              .filter((t: unknown): t is Row => !!t && typeof (t as { id?: unknown }).id === "string")
              .map((t: Row, i: number) => ({
                id: t.id,
                label: t.label || t.id,
                accent: TARGET_ACCENTS[i % TARGET_ACCENTS.length],
                accepts: t.accepts ?? null,
              }))
          : [];
        if (alive) setTargets(rows.length ? rows : FALLBACK_TARGETS);
      } catch {
        /* offline / not wired — FALLBACK_TARGETS stands */
      }
    })();
    return () => {
      alive = false;
    };
  }, [targetsNonce]);

  /**
   * Switching asset class can strip a destination of its channel, and a
   * selection that silently became unsendable is how an alert goes missing. So
   * changing class prunes the selection to what can still receive it.
   */
  useEffect(() => {
    setBots((prev) => prev.filter((id) => {
      const t = targets.find((x) => x.id === id);
      return t ? accepts(t, assetClass) : false;
    }));
  }, [assetClass, targets]);

  const toggleBot = (id: string) =>
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
  /**
   * The ONE transport call. POSTs the draft to /api/bot-alert, which owns the
   * webhook URLs and builds the embed — this sends fields, never HTML and never
   * a webhook URL.
   *
   * The append is NOT optimistic. With several destinations a partial failure
   * is the normal case, and a feed row that appeared before the send would be
   * claiming the alert went out when two of four rejected it. So the row is
   * written once the server has answered, carrying the per-destination results.
   *
   * The composer is only CLEARED when at least one destination took the alert.
   * On a total failure the draft stays exactly as typed, because the fix is
   * usually "try again in ten seconds", not "retype the thesis".
   */
  async function broadcast() {
    if (!canSend || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      const res = await fetch("/api/bot-alert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targets: bots,
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
          // BY NAME, not a resolved integer: 'auto' on a Note means NO bar,
          // which the server decides and a hex cannot express.
          bar: barChoice,
        }),
      });

      // The route answers JSON on every path, including its failures — read the
      // body for the reason rather than reducing it to a status code.
      const json = await res.json().catch(() => null);
      const results: SendResult[] = Array.isArray(json?.results) ? json.results : [];

      if (!json?.ok) {
        const why =
          json?.error ||
          results.find((r) => !r.ok)?.error ||
          `Broadcast failed (${res.status})`;
        setSendErr(why);
        return;
      }

      setFeed((prev) => [
        {
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
          avgPrice: avgPrice.trim(),
          notes: notes.trim(),
          image,
          bar,
          results,
        },
        ...prev,
      ]);

      const failed = results.filter((r) => !r.ok);
      const warned = results.filter((r) => r.ok && r.warning);
      if (failed.length) {
        setSendErr(`Sent to ${json.sent}/${json.of} — failed: ${failed.map((f) => f.label || f.id).join(", ")}`);
      } else if (warned.length) {
        // Posted fine, tag did not resolve. Surfacing this is the difference
        // between "the room was notified" and "you think the room was".
        setSendErr(`${warned[0].label || warned[0].id}: ${warned[0].warning}`);
      }

      setTicker("");
      setStrike("");
      setPrice("");
      setAvgPrice("");
      setNotes("");
      setImage(null);
      setTab("feed");
    } catch (err) {
      setSendErr(String((err as Error)?.message || err));
    } finally {
      setSending(false);
    }
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
            { id: "manage" as const, label: "⚙  Manage", count: 0 },
            { id: "scheduled" as const, label: "⏱  Scheduled", count: 0 },
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
                {targets.map((b) => {
                  const ok = accepts(b, assetClass);
                  return (
                    <Pill
                      key={b.id}
                      active={bots.includes(b.id)}
                      accent={b.accent}
                      disabled={!ok}
                      title={ok ? undefined : `${b.label} has no ${assetClass} channel — map one in Manage`}
                      onClick={() => ok && toggleBot(b.id)}
                    >
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
                        {!ok && " ·  no channel"}
                      </span>
                    </Pill>
                  );
                })}
                <Pill
                  active={bots.length > 0 && bots.length === targets.filter((t) => accepts(t, assetClass)).length}
                  accent={OWNER_THEME.lightBlue}
                  onClick={() => {
                    const eligible = targets.filter((t) => accepts(t, assetClass)).map((t) => t.id);
                    setBots(bots.length === eligible.length ? [] : eligible);
                  }}
                >
                  All
                </Pill>
              </div>
              {bots.length === 0 && (
                <div style={{ fontSize: 11, color: OWNER_THEME.red, marginTop: 8 }}>
                  Pick at least one Discord to broadcast to.
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
                  <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      inputMode="decimal"
                      placeholder={`$  ${PRICE_LABEL[action]}`}
                      style={{ ...homeInputStyle, flex: 1 }}
                    />
                    {/* Averaging down is the one action that carries TWO
                        numbers, and the second is the one people actually want:
                        where the add left your average. */}
                    {action === "average-down" && (
                      <input
                        value={avgPrice}
                        onChange={(e) => setAvgPrice(e.target.value)}
                        inputMode="decimal"
                        placeholder="$  New average"
                        style={{ ...homeInputStyle, flex: 1 }}
                      />
                    )}
                  </div>
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
                  <span style={{ width: 4, height: 14, borderRadius: 2, background: bar || "transparent" }} />
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
                  {bar ? `${bar} · ${barColorInt(bar)}` : "no bar"}
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
                  ? "No destination selected"
                  : `→ ${targets.filter((b) => bots.includes(b.id)).map((b) => b.label).join(" + ")}`}
              </div>
              <button
                type="button"
                onClick={broadcast}
                disabled={!canSend || sending}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "12px 24px",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 800,
                  letterSpacing: "0.02em",
                  cursor: canSend && !sending ? "pointer" : "not-allowed",
                  opacity: sending ? 0.7 : 1,
                  border: `1px solid ${rgba(CYAN, canSend ? 0.5 : 0.15)}`,
                  background: canSend
                    ? `linear-gradient(180deg, ${rgba(CYAN, 0.3)}, ${rgba(CYAN, 0.08)})`
                    : "rgba(255,255,255,0.03)",
                  color: canSend ? CYAN : OWNER_THEME.text,
                  boxShadow: canSend ? `0 0 20px ${rgba(CYAN, 0.22)}` : "none",
                  transition: "all 0.15s",
                }}
              >
                <span style={{ fontSize: 15 }}>{sending ? "⏳" : "🔔"}</span>
                {sending ? "Broadcasting…" : "Broadcast Alert"}
              </button>
            </div>

            {sendErr && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  fontSize: 12,
                  border: `1px solid ${rgba(OWNER_THEME.red, 0.4)}`,
                  background: rgba(OWNER_THEME.red, 0.1),
                  color: OWNER_THEME.text,
                }}
              >
                {sendErr}
              </div>
            )}
          </div>
        </Card>
      ) : tab === "manage" ? (
        /* Routing lives in its own file — this page is already the composer and
           the feed, and a third mode inline would bury both. Saving there can
           change what the composer may send to, so it bumps the targets fetch. */
        <BotManage onChanged={() => setTargetsNonce((n) => n + 1)} />
      ) : tab === "scheduled" ? (
        /* What the SERVER posts on a timer — separate from Manage, which is
           where a composed alert goes. Its own file for the same reason. */
        <BotScheduled />
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
                const accent = a.bar || OWNER_THEME.border;
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
                        {targets.filter((b) => a.bots.includes(b.id)).map((b) => {
                          // A tag says whether THAT destination took it — a row
                          // that only listed the intended targets would read as
                          // "delivered" even where Discord rejected the post.
                          const r = a.results.find((x) => x.id === b.id);
                          const bad = r != null && !r.ok;
                          return (
                          <span
                            key={b.id}
                            title={bad ? r?.error : undefined}
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              padding: "2px 8px",
                              borderRadius: 999,
                              border: `1px solid ${rgba(bad ? OWNER_THEME.red : b.accent, 0.3)}`,
                              background: rgba(bad ? OWNER_THEME.red : b.accent, 0.1),
                              color: bad ? OWNER_THEME.red : b.accent,
                              textDecoration: bad ? "line-through" : "none",
                            }}
                          >
                            {bad ? "✕ " : ""}
                            {b.label}
                          </span>
                          );
                        })}
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
