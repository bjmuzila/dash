import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HOME_THEME,
  RETA_PALETTE,
  TYPE,
  rgba,
  homeInputStyle,
  homeButtonStyle,
  homeSecondaryButtonStyle,
} from "../../lib/theme";
import { Card } from "../../components/PageCard";
import { ThemedSelect } from "../../components/ThemedSelect";
import { SpendDonut, type DonutSlice } from "./SpendDonut";
import {
  CategoryBudgetSection,
  DONUT_RAMP,
  DONUT_NEUTRAL,
  UNCATEGORIZED,
  type TrendPoint,
} from "./CategoryBudget";
import { useIsMobile, scrollX } from "../../hooks/useIsMobile";

/**
 * Budget → Real Month.
 *
 * What actually cleared, read off a bank/card statement CSV, PDF or screenshot
 * and stored in budget_statement_tx — a table Overview and Payments never touch.
 *
 * CSV is the accurate path and worth preferring when the bank offers it: the
 * server parses the columns itself, so amounts and dates come across exactly as
 * exported. Only the merchant name and the category are inferred. PDFs and
 * screenshots go through vision, where every field is a reading.
 *
 * That separation is the whole point. The register is the PLAN: expected
 * payments plus recurring rules projected forward. This is the TRUTH: what the
 * bank says left the account. Writing statement rows into the register would
 * double-count every dollar that appears in both, so nothing here flows into
 * the plan automatically. The one bridge is per-subscription: → Payments adds
 * ONE monthly recurring rule. There is no bulk commit, by design.
 *
 * Order on the page is deliberate — "What to fix" is the conclusion and sits at
 * the very top; the raw data that produced it lives underneath.
 *
 * Views:
 *   Merchants  — one row per vendor, grouped under its category, expandable.
 *                One dropdown re-files every transaction from that vendor.
 *   Where it went — donut of category share, each slice expanding to its
 *                merchants, with a table view for the close calls.
 *   Ledger     — flat, sortable, every transaction.
 *   Categories — real spend against the budgets on the Categories tab.
 *   Subscriptions — repeat charges, tagged Keep / Cancel / Watch.
 *
 * Theme: every chrome colour resolves from src/lib/theme.ts (HOME_THEME + the
 * rgba() helper), and panels use the shared <Card> primitive. The one page-local
 * colour decision is the money pair below, explained where it is declared.
 */

// The theme's `green` token is #8ECAE6 — a light blue that reads as the same
// colour as `lightBlue`, which makes a red/green money column unreadable.
// RETA_PALETTE.green is the theme's only true green, so positives use it. Both
// still come from the theme file; no hex is hardcoded here.
const MONEY_IN = RETA_PALETTE.green;
const MONEY_OUT = HOME_THEME.red;
const ACCENT = HOME_THEME.lightBlue;
const WARN = HOME_THEME.gold;

/** Category swatch ramp for the merchant-group bands — theme tokens only. */
const RAMP = [HOME_THEME.cyan, ACCENT, WARN, HOME_THEME.orange, RETA_PALETTE.rose, RETA_PALETTE.peach, HOME_THEME.green, RETA_PALETTE.green];

/**
 * Donut series colours — the ONE place this file carries hex literals, and
 * deliberately so: these are a data encoding, not chrome.
 *
 * Eight hues stepped evenly off the theme's cyan at a fixed chroma, with
 * lightness alternating between two values. The alternation is what makes it
 * work: deuteranopia flattens the red↔green axis, so neighbours that differ
 * only in hue collapse — giving them different lightness keeps them apart.
 * Validated against the dark panel surface: worst adjacent pair ΔE 10.7 under
 * protanopia and 15.5 with normal vision, all eight inside the dark-mode
 * lightness band.
 *
 * Two slots land a hair under 3:1 contrast on the panel. That is allowed only
 * because identity never rests on colour here — every segment is directly
 * labelled or named in the row list, and there is a full Table view.
 *
 * Slots are assigned by STABLE category order (id ascending), never by this
 * month's ranking — a category keeps its colour when the amounts move, so
 * "Groceries is violet" stays true month to month.
 */
/** Hard ceiling on drawn categories — past this the arcs stop being readable. */
const DONUT_MAX_SLICES = 8;

// ── control styles, all derived from theme tokens ───────────────────────────
function field(): React.CSSProperties {
  return {
    ...homeInputStyle,
    width: "100%",
    boxShadow: `inset 0 1px 3px ${rgba("#000000", 0.45)}`,
    colorScheme: "dark",
    accentColor: HOME_THEME.cyan,
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "textfield" as const,
  };
}
function labelCap(): React.CSSProperties {
  return { fontSize: TYPE.label, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em", color: HOME_THEME.muted, opacity: 0.7, marginBottom: 6 };
}
function primary(): React.CSSProperties {
  return {
    ...homeButtonStyle,
    border: `1px solid ${rgba(HOME_THEME.cyan, 0.6)}`,
    background: `linear-gradient(180deg, ${rgba(HOME_THEME.cyan, 0.3)}, ${rgba(HOME_THEME.cyan, 0.08)})`,
    boxShadow: `0 0 24px ${rgba(HOME_THEME.cyan, 0.4)}, inset 0 1px 0 ${rgba("#ffffff", 0.12)}`,
    color: ACCENT, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap",
  };
}
function ghost(): React.CSSProperties {
  return { ...homeSecondaryButtonStyle, fontWeight: 800, whiteSpace: "nowrap" };
}
function pill(active: boolean): React.CSSProperties {
  return {
    padding: "7px 14px", borderRadius: 999,
    border: `1px solid ${active ? rgba(HOME_THEME.cyan, 0.75) : HOME_THEME.border}`,
    background: active ? `linear-gradient(180deg, ${rgba(HOME_THEME.cyan, 0.3)}, ${rgba(HOME_THEME.cyan, 0.1)})` : rgba("#ffffff", 0.03),
    boxShadow: active ? `0 0 22px ${rgba(HOME_THEME.cyan, 0.5)}, inset 0 1px 0 ${rgba("#ffffff", 0.1)}` : "none",
    color: active ? HOME_THEME.cyan : HOME_THEME.text,
    opacity: active ? 1 : 0.82,
    fontSize: 13, fontWeight: 800, cursor: "pointer",
  };
}
function chip(active: boolean, color: string): React.CSSProperties {
  return {
    padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 900, letterSpacing: "0.08em",
    border: `1px solid ${active ? color : HOME_THEME.border}`,
    background: active ? rgba(color, 0.13) : rgba("#ffffff", 0.02),
    color: active ? color : HOME_THEME.text,
    opacity: active ? 1 : 0.5,
    cursor: "pointer", textTransform: "uppercase",
  };
}
function th(align: "left" | "right" | "center"): React.CSSProperties {
  return {
    textAlign: align, padding: "10px 14px", color: HOME_THEME.muted, opacity: 0.65, fontWeight: 800,
    fontSize: TYPE.label, textTransform: "uppercase", letterSpacing: "0.12em",
    borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap",
  };
}
function td(align: "left" | "right" | "center"): React.CSSProperties {
  return { textAlign: align, padding: "8px 14px", fontSize: TYPE.body, borderBottom: `1px solid ${rgba("#ffffff", 0.05)}` };
}
const MUTED: React.CSSProperties = { color: HOME_THEME.muted, opacity: 0.62 };

// ── types ───────────────────────────────────────────────────────────────────
type Bank = "coastal" | "truist" | "secu";
type Category = { id: number; name: string; amount: number; color?: string | null };
type SubStatus = "keep" | "cancel" | "watch";
/**
 * What a recurring charge IS, which is a different question from what to do
 * about it. Nearly everything that repeats is tagged "keep", so the verdict
 * column alone cannot answer "how much of this load is a real bill and how
 * much is optional" — the number that actually matters when money is tight.
 *   bill   — power, water, phone, insurance, rent. Cutting it is not on the table.
 *   luxury — streaming, apps, extras. Not 100% needed.
 */
type SubKind = "bill" | "luxury";

type StagedRow = {
  key: string; date: string; description: string; merchant: string;
  amount: number; direction: "in" | "out"; categoryId: number | null;
  categoryGuess: string; recurring: boolean; include: boolean;
};

type StoredTx = {
  id: number; month: string; tx_date: string; description: string; merchant: string;
  amount: number; direction: "in" | "out"; category_id: number | null;
  is_recurring: number; bank: Bank; source: string | null;
};

type Subscription = {
  id: number; merchant_key: string; merchant: string;
  status: SubStatus; kind: SubKind | null; note: string | null; pushed_recurring_id: number | null;
};

type MonthStat = { month: string; n: number };

/**
 * The fuel correction, as the server applied it.
 *
 * Every Sheetz swipe is filed to one fuel category, Flex fill-ups included —
 * you cannot tell them apart at the till. What is known per month is the Flex
 * share, off the Amazon tab. The server MOVES that much from the fuel category
 * into the Flex category on every read of /api/budget/real, so the month totals
 * still add up and no re-filing by hand is needed.
 *
 * `flexGas` is what the Amazon tab holds for a month; `flexMoved` is what was
 * actually re-filed after capping at what the fuel category held.
 */
type FuelSplit = {
  categoryId: number | null; categoryName: string | null;
  flexCategoryId: number | null; flexCategoryName: string | null;
  flexGas: Record<string, number>;
  flexMoved: Record<string, number>;
};

type Finding = { title: string; severity: "high" | "medium" | "low"; detail: string; monthlySavings: number; evidence: string };
type Advice = { headline: string; findings: Finding[]; quickWins: string[]; generatedAt?: string | null };

type View = "merchants" | "donut" | "ledger" | "categories" | "subs";
type SortKey = "date" | "merchant" | "amount" | "category";

type RegisterBatch = {
  bucket: string; first_at: string; last_at: string; n: number;
  total: number; from_date: string; to_date: string; labels: string[];
};

/** One vendor, with every transaction behind it. */
type MerchantRow = {
  key: string; merchant: string; total: number; count: number;
  categoryId: number | null; categoryName: string; mixedCategory: boolean;
  amounts: number[]; flagged: boolean; rows: StoredTx[];
};

const BANKS: Bank[] = ["coastal", "truist", "secu"];
const BANK_LABEL: Record<Bank, string> = { coastal: "COASTAL", truist: "TRUIST", secu: "SECU" };
/** Merchants shown per category before the "+n more" link. */
const PER_CAT_LIMIT = 6;

const SEVERITY_UI: Record<Finding["severity"], { color: string; label: string }> = {
  high: { color: HOME_THEME.red, label: "HIGH" },
  medium: { color: WARN, label: "MEDIUM" },
  low: { color: ACCENT, label: "LOW" },
};
const STATUS_UI: Record<SubStatus, { color: string; label: string }> = {
  keep: { color: MONEY_IN, label: "Keep" },
  cancel: { color: HOME_THEME.red, label: "Cancel" },
  watch: { color: WARN, label: "Watch" },
};
const KIND_UI: Record<SubKind, { color: string; label: string; heading: string; blurb: string }> = {
  bill: {
    color: ACCENT, label: "Bill", heading: "Real bills",
    blurb: "Keeping the lights on. This is the floor the month has to clear.",
  },
  luxury: {
    color: WARN, label: "Luxury", heading: "Luxury / not 100% needed",
    blurb: "Everything above the floor. This is the number that moves when money is tight.",
  },
};

/**
 * A first guess at bill-vs-luxury from the merchant name, used ONLY for rows
 * that have never been tagged. Without it the whole list lands in one
 * undifferentiated "unsorted" pile and the split answers nothing until every
 * row has been clicked. A guessed row is drawn with a dotted chip and is not
 * written to the database — clicking either chip is what stores a decision.
 */
const BILL_HINTS = /\b(rent|mortgage|escrow|insur|geico|progressive|allstate|statefarm|electric|power|energy|duke|gas co|water|sewer|trash|waste|utility|utilities|internet|spectrum|xfinity|comcast|at&?t|verizon|t-?mobile|mint ?mobile|phone|wireless|daycare|childcare|tuition|school|loan|lending|credit|card ?pmt|payment|storage|hoa|pharmacy|medical|dental|vision|health|gym membership|life ins)\b/i;
const LUXURY_HINTS = /\b(netflix|hulu|disney|max|hbo|paramount|peacock|prime video|spotify|apple music|pandora|tidal|youtube|twitch|patreon|onlyfans|xbox|playstation|nintendo|steam|roblox|discord|audible|kindle|chatgpt|openai|claude|anthropic|midjourney|canva|adobe|dropbox|icloud|google one|notion|substack|nyt|news|doordash|ubereats|grubhub|instacart|starbucks|dunkin|coffee|gaming|vpn|nordvpn)\b/i;
function guessKind(merchant: string): SubKind {
  const m = String(merchant || "");
  if (LUXURY_HINTS.test(m)) return "luxury";
  if (BILL_HINTS.test(m)) return "bill";
  // Unknown repeats default to luxury on purpose: the cost of wrongly calling
  // a bill optional is one click, and the cost of the reverse is a padded
  // "real bills" floor that quietly excuses the spend.
  return "luxury";
}

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount || 0);
}
function shortDate(iso: string): string {
  const [, m, d] = String(iso).split("-").map(Number);
  return Number.isFinite(m) && Number.isFinite(d) ? `${m}/${d}` : String(iso);
}
function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  if (!y || !mo) return m;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1]} ’${String(y).slice(2)}`;
}
/** "3 days ago" — how stale the stored analysis is. */
function sinceLabel(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
/**
 * The merchant grouping key. Must stay identical to `merchantKey` in
 * server-v2/api-router.js and MERCHANT_KEY_SQL in _lib-db.cjs — the whole
 * "re-file this merchant everywhere" path is a join on this string, so a
 * divergence here silently updates nothing.
 */
function mKey(v: string): string {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
}
/** Whether a category edit spreads to every month. See the state comment. */
const ALL_MONTHS_KEY = "budget:real:cat-all-months";
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Could not read that file."));
    fr.onload = () => {
      const s = String(fr.result || "");
      const comma = s.indexOf(",");
      resolve(comma === -1 ? s : s.slice(comma + 1));
    };
    fr.readAsDataURL(file);
  });
}

export default function RealMonth({
  month,
  onMonth,
  categories,
  currency,
  defaultBank = "secu",
  onOpenCategories,
  onCategoriesChanged,
}: {
  /** YYYY-MM, driven by the month picker at the top of the Budget page. */
  month: string;
  /** Lets the month chips drive the page's picker. */
  onMonth?: (m: string) => void;
  categories: Category[];
  currency: string;
  defaultBank?: Bank;
  onOpenCategories?: () => void;
  /** Called after a budget edit lands, so the page re-reads its categories. */
  onCategoriesChanged?: () => void | Promise<void>;
}) {
  const isMobile = useIsMobile();
  const [tx, setTx] = useState<StoredTx[]>([]);
  /**
   * Category edits are held here until Save, keyed by transaction id. Nothing
   * is written per keystroke — the earlier build fired one request per change,
   * so a failure mid-way left the screen and the database disagreeing, which
   * looked exactly like "it reverted on refresh".
   *
   * Deliberately NOT cleared when the month changes: ids are unique across
   * months, so you can re-file July, flip to August, and still save both.
   */
  const [pending, setPending] = useState<Map<number, number | null>>(new Map());
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [months, setMonths] = useState<MonthStat[]>([]);
  /** Raw (month, category) totals from /api/budget/real, handed to the shared
      CategoryBudgetSection so it does not have to re-fetch what this already
      loaded. */
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [fuel, setFuel] = useState<FuelSplit | null>(null);
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [view, setView] = useState<View>("merchants");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [showAllIn, setShowAllIn] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [onlyUncat, setOnlyUncat] = useState(false);
  const [bank, setBank] = useState<Bank>(defaultBank);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [advising, setAdvising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [adviceOpen, setAdviceOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  /**
   * Whether a category change also re-files that merchant in every OTHER month.
   *
   * ON by default, because that is what a category edit means: filing Blue
   * Bottle under Coffee is a fact about Blue Bottle, not about the row that
   * happened to be on screen. Left off, the same fix has to be repeated in
   * every month and the category trend is drawn from a history that disagrees
   * with itself. The toggle exists for the genuine exception — a merchant that
   * really did change what it was, e.g. a card used for groceries until March
   * and for fuel after.
   *
   * localStorage because it is a working preference, not data.
   */
  const [allMonths, setAllMonths] = useState<boolean>(() => {
    try { return localStorage.getItem(ALL_MONTHS_KEY) !== "0"; } catch { return true; }
  });
  const toggleAllMonths = (next: boolean) => {
    setAllMonths(next);
    try { localStorage.setItem(ALL_MONTHS_KEY, next ? "1" : "0"); } catch { /* private mode — just don't persist */ }
  };
  const [sourceName, setSourceName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  /** Stored rows with the unsaved edits laid over them — every rollup, the
      donut and the ledger read this, so the page previews what Save will do. */
  const txView = useMemo<StoredTx[]>(
    () => (pending.size ? tx.map((r) => (pending.has(r.id) ? { ...r, category_id: pending.get(r.id) ?? null } : r)) : tx),
    [tx, pending]
  );

  // ── load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/budget/real?month=${m}`, { cache: "no-store" });
      if (!res.ok) { setError("Could not load this month's statement data."); return; }
      const data = await res.json();
      setTx((data.tx || []).map((r: StoredTx) => ({ ...r, amount: Number(r.amount) })));
      setSubs(data.subscriptions || []);
      setMonths((data.months || []).map((x: MonthStat) => ({ month: x.month, n: Number(x.n) })));
      setTrend(
        (data.trend || []).map((p: TrendPoint) => ({
          month: String(p.month),
          categoryId: p.categoryId == null ? null : Number(p.categoryId),
          spent: Number(p.spent) || 0,
          count: Number(p.count) || 0,
        }))
      );
      setFuel(data.fuel ?? null);
      // The stored pass for this month, if one was ever run. It stays until a
      // re-run overwrites it, so reloading costs nothing.
      setAdvice(data.advice ?? null);
    } catch {
      setError("Could not load this month's statement data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
    // advice is NOT cleared here — load() replaces it with whatever is stored
    // for the new month, so switching months never throws a paid result away.
    setStaged([]);
    setExpanded(new Set());
    setShowAllIn(new Set());
    setQ("");
  }, [month, load]);

  // The browser's own guard — this is the exact thing that lost work before.
  useEffect(() => {
    if (!pending.size) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending.size]);

  // ── parse a dropped file into the staging table ──────────────────────────
  const handleFiles = async (files: FileList | File[] | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setError(null);
    setNotice(null);
    setParsing(true);
    try {
      let added = 0;
      let hitError = false;
      let warned: string | null = null;
      for (const file of list) {
        // CSV first: a .csv is often handed over with type "application/vnd.ms-excel"
        // (Excel claims the extension on Windows) or an empty type from a drag,
        // so the extension is the reliable test, not the MIME type.
        const isCsv = /\.(csv|tsv)$/i.test(file.name) || file.type === "text/csv";
        const isPdf = !isCsv && (file.type === "application/pdf" || /\.pdf$/i.test(file.name));
        const isImg = !isCsv && file.type.startsWith("image/");
        if (!isCsv && !isPdf && !isImg) { setError(`${file.name} isn't a CSV, a PDF or an image — skipped.`); hitError = true; continue; }
        if (file.size > 25 * 1024 * 1024) { setError(`${file.name} is over 25 MB — split it and try again.`); hitError = true; continue; }

        const data = await fileToBase64(file);
        const res = await fetch("/api/budget/parse-statement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: isCsv ? "csv" : isPdf ? "pdf" : "image", data,
            mediaType: file.type || (isPdf ? "application/pdf" : isCsv ? "text/csv" : "image/png"),
            categories: categories.map((c) => ({ id: c.id, name: c.name })),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          // The CSV path returns `detail` with the header row it actually read,
          // which is the whole diagnosis when a column map misses.
          setError([json?.error || `Parse failed (${res.status}).`, json?.detail].filter(Boolean).join(" — "));
          hitError = true;
          continue;
        }
        if (json?.warning) warned = String(json.warning);

        const parsed: StagedRow[] = (json.rows || []).map((r: Record<string, unknown>, i: number) => ({
          key: `${file.name}-${i}-${String(r.date)}-${String(r.amount)}`,
          date: String(r.date ?? ""),
          description: String(r.description ?? ""),
          merchant: String(r.merchant ?? r.description ?? ""),
          amount: Number(r.amount ?? 0),
          direction: r.direction === "in" ? "in" : "out",
          categoryId: r.categoryId == null ? null : Number(r.categoryId),
          categoryGuess: String(r.categoryGuess ?? ""),
          recurring: r.recurring === true,
          include: true,
        }));
        added += parsed.length;
        setStaged((prev) => [...prev, ...parsed].sort((a, b) => a.date.localeCompare(b.date)));
        setSourceName(file.name);
      }
      if (added) setNotice(`Read ${added} transaction${added === 1 ? "" : "s"}. Check them, then save.${warned ? ` (${warned})` : ""}`);
      else if (!hitError) setError("No transactions could be read from that file.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed.");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const patchStaged = (key: string, next: Partial<StagedRow>) =>
    setStaged((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /** Save the staged rows into budget_statement_tx. Never touches the register. */
  const saveStaged = async () => {
    const rows = staged.filter((r) => r.include);
    if (!rows.length) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/budget/real", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import", month, source: sourceName,
          rows: rows.map((r) => ({
            date: r.date, description: r.description, merchant: r.merchant,
            amount: r.amount, direction: r.direction, categoryId: r.categoryId,
            recurring: r.recurring, bank,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) { setError(json?.error || "Save failed."); return; }
      setNotice(
        `Saved ${json.inserted} to Real Month${json.skipped ? ` · ${json.skipped} already there (skipped)` : ""}` +
        // Rows the server filed from how the same merchant was categorized in
        // earlier months — a decision made once, not re-asked every import.
        `${json.inherited ? ` · ${json.inherited} categorized from earlier months` : ""}. Payments and Overview are untouched.`
      );
      setStaged([]);
      await load(month);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/budget/real", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!res.ok) { setError("That change didn't save."); return null; }
    return res.json().catch(() => null);
  };

  /** Stage one row's category. Nothing hits the database until Save. */
  const setTxCategory = (id: number, categoryId: number | null) => {
    setPending((prev) => {
      const n = new Map(prev);
      const original = tx.find((r) => r.id === id)?.category_id ?? null;
      // Setting a row back to what it already is isn't an edit — drop it, so
      // the unsaved count only ever reflects real changes.
      if (original === categoryId) n.delete(id);
      else n.set(id, categoryId);
      return n;
    });
  };

  /** Stage every row from one merchant at once. */
  const setMerchantCategory = (merchant: string, categoryId: number | null) => {
    const key = mKey(merchant);
    setPending((prev) => {
      const n = new Map(prev);
      for (const r of tx) {
        if (mKey(r.merchant || r.description) !== key) continue;
        if ((r.category_id ?? null) === categoryId) n.delete(r.id);
        else n.set(r.id, categoryId);
      }
      return n;
    });
  };

  /** Write the whole batch in one request. */
  const saveCategories = async () => {
    if (!pending.size) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    // The merchant rides along with each change so the server can carry the
    // decision to that merchant's rows in every other month. Same fallback the
    // rollups group on (merchant, else description), so what the UI shows as
    // one merchant is what gets re-filed.
    const changes = [...pending.entries()].map(([id, categoryId]) => {
      const row = tx.find((r) => r.id === id);
      return { id, categoryId, merchant: row ? row.merchant || row.description : "" };
    });
    try {
      const out = await post({ action: "setCategoriesBulk", changes, allMonths });
      if (!out?.ok) { setError("Categories did not save — nothing was changed."); return; }
      setPending(new Map());
      const spread = Number(out.spread ?? 0);
      setNotice(
        `Saved ${out.updated} categor${out.updated === 1 ? "y" : "ies"}.` +
        (allMonths
          ? spread > 0
            ? ` Also re-filed ${spread} matching row${spread === 1 ? "" : "s"} in other months.`
            : " Every other month already agreed."
          : " This month only.")
      );
      await load(month);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Categories did not save.");
    } finally {
      setSaving(false);
    }
  };

  const deleteTx = async (id: number) => {
    setTx((prev) => prev.filter((r) => r.id !== id));
    await post({ action: "deleteTx", id });
  };
  const clearMonth = async () => {
    setSaving(true);
    const out = await post({ action: "clearMonth", month });
    if (out) setNotice(`Cleared ${out.removed ?? 0} rows from ${month}.`);
    await load(month);
    setSaving(false);
  };

  // ── merchant rollup ──────────────────────────────────────────────────────
  const allMerchants = useMemo<MerchantRow[]>(() => {
    const map = new Map<string, MerchantRow>();
    for (const r of txView) {
      if (r.direction !== "out") continue;
      const k = mKey(r.merchant || r.description);
      const hit = map.get(k);
      if (hit) {
        hit.total += r.amount;
        hit.count += 1;
        hit.amounts.push(r.amount);
        hit.rows.push(r);
        hit.flagged = hit.flagged || r.is_recurring === 1;
        if (hit.categoryId !== r.category_id) hit.mixedCategory = true;
        if (hit.categoryId == null) hit.categoryId = r.category_id;
      } else {
        map.set(k, {
          key: k, merchant: r.merchant || r.description, total: r.amount, count: 1,
          categoryId: r.category_id, categoryName: "", mixedCategory: false,
          amounts: [r.amount], flagged: r.is_recurring === 1, rows: [r],
        });
      }
    }
    for (const m of map.values()) {
      m.categoryName = m.categoryId != null ? catById.get(m.categoryId)?.name ?? UNCATEGORIZED : UNCATEGORIZED;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [txView, catById]);

  /** Search + "needs a category" narrow the list before it is grouped. */
  const visibleMerchants = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allMerchants.filter((m) => {
      if (onlyUncat && m.categoryId != null && !m.mixedCategory) return false;
      if (!needle) return true;
      return m.merchant.toLowerCase().includes(needle) || m.categoryName.toLowerCase().includes(needle);
    });
  }, [allMerchants, q, onlyUncat]);

  /**
   * The flat merchant list gets long fast (a month of card activity is easily
   * 60+ vendors), so it is grouped under its category, biggest category first,
   * and each group is capped until you ask for the rest.
   */
  const merchantGroups = useMemo(() => {
    const map = new Map<string, { name: string; color: string; total: number; rows: MerchantRow[] }>();
    for (const m of visibleMerchants) {
      const name = m.categoryName;
      const hit = map.get(name);
      if (hit) { hit.total += m.total; hit.rows.push(m); }
      else map.set(name, { name, color: HOME_THEME.cyan, total: m.total, rows: [m] });
    }
    const out = [...map.values()].sort((a, b) => b.total - a.total);
    out.forEach((g, i) => {
      const cat = categories.find((c) => c.name === g.name);
      g.color = cat?.color || (g.name === UNCATEGORIZED ? HOME_THEME.muted : RAMP[i % RAMP.length]);
    });
    return out;
  }, [visibleMerchants, categories]);

  // ── category rollup vs the budgets on the Categories tab ─────────────────
  // Recomputed from txView rather than read off the server's trend, because it
  // has to preview UNSAVED category edits. That means the fuel move has to be
  // applied here too — and re-capped locally, since a pending edit can change
  // how much is sitting in the fuel category this second.
  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; spent: number; count: number; budget: number; color: string | null }>();
    for (const r of txView) {
      if (r.direction !== "out") continue;
      const cat = r.category_id != null ? catById.get(r.category_id) : undefined;
      const name = cat?.name || UNCATEGORIZED;
      const k = name.toLowerCase();
      const hit = map.get(k);
      if (hit) { hit.spent += r.amount; hit.count += 1; }
      else map.set(k, { name, spent: r.amount, count: 1, budget: cat?.amount ?? 0, color: cat?.color ?? null });
    }

    const gas = fuel?.flexGas?.[month] ?? 0;
    const fuelCat = fuel?.categoryId != null ? catById.get(fuel.categoryId) : undefined;
    if (gas > 0 && fuelCat) {
      const src = map.get(fuelCat.name.toLowerCase());
      const move = src ? Math.min(gas, src.spent) : 0;
      if (src && move > 0) {
        src.spent -= move;
        const flexCat = fuel?.flexCategoryId != null ? catById.get(fuel.flexCategoryId) : undefined;
        if (flexCat) {
          const dk = flexCat.name.toLowerCase();
          const dest = map.get(dk);
          if (dest) dest.spent += move;
          else map.set(dk, { name: flexCat.name, spent: move, count: 0, budget: flexCat.amount ?? 0, color: flexCat.color ?? null });
        }
      }
    }
    return [...map.values()].sort((a, b) => b.spent - a.spent);
  }, [txView, catById, fuel, month]);

  /** What the fuel move did THIS month, for the note under the category table. */
  const fuelNote = useMemo(() => {
    const gas = fuel?.flexGas?.[month] ?? 0;
    if (!(gas > 0) || fuel?.categoryId == null) return null;
    const fuelCat = catById.get(fuel.categoryId);
    if (!fuelCat) return null;
    let filed = 0;
    for (const r of txView) if (r.direction === "out" && r.category_id === fuel.categoryId) filed += r.amount;
    // filed is already net of nothing — the move is applied on top of it.
    const gross = filed;
    const moved = Math.min(gas, gross);
    if (!(moved > 0)) return null;
    return {
      fuelName: fuelCat.name,
      flexName: fuel.flexCategoryId != null ? catById.get(fuel.flexCategoryId)?.name ?? null : null,
      gross, moved, net: gross - moved,
      uncovered: gas - moved,
    };
  }, [fuel, month, txView, catById]);

  // ── subscriptions ────────────────────────────────────────────────────────
  const subRows = useMemo(() => {
    const byKey = new Map(subs.map((s) => [s.merchant_key, s]));
    return allMerchants
      .map((m) => {
        const sorted = [...m.amounts].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] || 0;
        const tight = median > 0 && m.amounts.every((a) => Math.abs(a - median) <= median * 0.05);
        const repeats = m.count >= 2 && tight;
        if (!repeats && !m.flagged) return null;
        const saved = byKey.get(m.key);
        const storedKind = (saved?.kind ?? null) as SubKind | null;
        return {
          merchant: m.merchant, key: m.key, count: m.count,
          each: repeats ? median : m.total, total: m.total,
          monthly: repeats ? median : m.total,
          categoryId: m.categoryId,
          status: (saved?.status ?? "watch") as SubStatus,
          kind: storedKind ?? guessKind(m.merchant),
          // True while the row is sitting in a guessed group. It still counts
          // toward that group's total — a guess you have not corrected is the
          // best answer available — but it is drawn so you can see it is one.
          kindGuessed: storedKind == null,
          pushedId: saved?.pushed_recurring_id ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.monthly - a.monthly);
  }, [allMerchants, subs]);

  const setSubStatus = async (merchant: string, status: SubStatus) => {
    const key = mKey(merchant);
    setSubs((prev) => {
      const i = prev.findIndex((s) => s.merchant_key === key);
      if (i === -1) return [...prev, { id: -Date.now(), merchant_key: key, merchant, status, kind: null, note: null, pushed_recurring_id: null }];
      const next = [...prev];
      next[i] = { ...next[i], status };
      return next;
    });
    await post({ action: "setSubscription", merchant, status });
  };

  // Independent of the verdict — the server COALESCEs, so writing a kind never
  // touches keep/watch/cancel and vice versa.
  const setSubKind = async (merchant: string, kind: SubKind) => {
    const key = mKey(merchant);
    setSubs((prev) => {
      const i = prev.findIndex((s) => s.merchant_key === key);
      if (i === -1) return [...prev, { id: -Date.now(), merchant_key: key, merchant, status: "watch", kind, note: null, pushed_recurring_id: null }];
      const next = [...prev];
      next[i] = { ...next[i], kind };
      return next;
    });
    await post({ action: "setSubscription", merchant, kind });
  };

  const pushToPayments = async (merchant: string, amount: number) => {
    const out = await post({ action: "pushSubscription", merchant, amount, bank, anchorDate: `${month}-01`, status: "keep" });
    if (!out?.ok) return;
    setNotice(`${merchant} added to Payments as a monthly recurring rule (${fmtMoney(amount, currency)}). Nothing else was copied over.`);
    const res = await fetch(`/api/budget/real?month=${month}`, { cache: "no-store" });
    if (res.ok) { const d = await res.json(); setSubs(d.subscriptions || []); }
  };

  // ── flat ledger ──────────────────────────────────────────────────────────
  const ledgerRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let base = onlyUncat ? txView.filter((r) => r.category_id == null) : txView;
    if (needle) base = base.filter((r) => `${r.merchant} ${r.description}`.toLowerCase().includes(needle));
    const dir = sortDir === "asc" ? 1 : -1;
    const catName = (r: StoredTx) => (r.category_id == null ? "￿" : catById.get(r.category_id)?.name ?? "￿");
    return [...base].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.tx_date.localeCompare(b.tx_date);
      else if (sortKey === "amount") cmp = a.amount - b.amount;
      else if (sortKey === "merchant") cmp = mKey(a.merchant).localeCompare(mKey(b.merchant));
      else cmp = catName(a).localeCompare(catName(b));
      if (cmp === 0 && sortKey !== "date") cmp = a.tx_date.localeCompare(b.tx_date);
      return cmp * dir;
    });
  }, [txView, sortKey, sortDir, onlyUncat, catById, q]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const n = new Set(set);
    if (n.has(k)) n.delete(k); else n.add(k);
    setter(n);
  };

  // ── totals ───────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const outflow = txView.filter((r) => r.direction === "out").reduce((s, r) => s + r.amount, 0);
    const inflow = txView.filter((r) => r.direction === "in").reduce((s, r) => s + r.amount, 0);
    const uncategorized = txView.filter((r) => r.direction === "out" && r.category_id == null).length;
    const subTotal = subRows.reduce((s, m) => s + m.monthly, 0);
    const cancelSavings = subRows.filter((s) => s.status === "cancel").reduce((s, m) => s + m.monthly, 0);
    // The split the whole tab exists for: what has to be paid vs what is
    // choice. Guessed rows are counted in their guessed group.
    const billTotal = subRows.filter((s) => s.kind === "bill").reduce((s, m) => s + m.monthly, 0);
    const luxuryTotal = subRows.filter((s) => s.kind === "luxury").reduce((s, m) => s + m.monthly, 0);
    const untagged = subRows.filter((s) => s.kindGuessed).length;
    return { outflow, inflow, net: inflow - outflow, uncategorized, subTotal, cancelSavings, billTotal, luxuryTotal, untagged };
  }, [txView, subRows]);

  const potentialSavings = useMemo(
    () => (advice?.findings ?? []).reduce((s, f) => s + (f.monthlySavings || 0), 0),
    [advice]
  );

  // ── donut: category share, each slice expanding to its merchants ─────────
  // Colour is bound to the category's identity (stable id order), not to its
  // rank this month, so a month with different amounts never repaints the
  // categories a reader has already learned.
  const donut = useMemo(() => {
    const slotOf = new Map<string, number>();
    [...categories].sort((a, b) => a.id - b.id).forEach((c, i) => slotOf.set(c.name, i % DONUT_RAMP.length));

    const ranked = byCategory.filter((c) => c.spent > 0);

    // Where to cut. A fixed top-N is wrong: it happily produced an "Other"
    // band bigger than four of the categories it was hiding, which reads as a
    // mystery category near the top of the chart. Instead take the SMALLEST
    // cut whose folded tail is smaller than the smallest slice still drawn —
    // so "Other", when it exists, is always the last segment and never
    // outranks something real. Falls back to the ceiling if no cut qualifies.
    const cut = (() => {
      const max = Math.min(ranked.length, DONUT_MAX_SLICES);
      for (let n = 1; n <= max; n++) {
        const tailTotal = ranked.slice(n).reduce((sum, c) => sum + c.spent, 0);
        if (tailTotal === 0 || tailTotal < ranked[n - 1].spent) return n;
      }
      return max;
    })();
    const head = ranked.slice(0, cut);
    const tail = ranked.slice(cut);

    // Two drawn categories can land on the same slot when more than six exist.
    // Bump the later one to the next free slot — deterministic for a given set.
    const taken = new Set<number>();
    const colorFor = (name: string): string => {
      if (name === UNCATEGORIZED) return DONUT_NEUTRAL;
      let slot = slotOf.get(name) ?? 0;
      for (let i = 0; i < DONUT_RAMP.length && taken.has(slot); i++) slot = (slot + 1) % DONUT_RAMP.length;
      taken.add(slot);
      return DONUT_RAMP[slot];
    };

    const slices: DonutSlice[] = head.map((c) => ({
      key: c.name,
      name: c.name,
      color: colorFor(c.name),
      total: c.spent,
      count: c.count,
      kind: "cat" as const,
      children: allMerchants
        .filter((m) => m.categoryName === c.name)
        .map((m) => ({ name: m.merchant, total: m.total, count: m.count, recurring: m.flagged })),
    }));

    if (tail.length) {
      slices.push({
        key: "__other",
        name: "Other",
        color: DONUT_NEUTRAL,
        total: tail.reduce((s2, c) => s2 + c.spent, 0),
        count: tail.reduce((s2, c) => s2 + c.count, 0),
        kind: "other" as const,
        // The tail expands to the categories it swallowed, not to raw merchants.
        children: tail.map((c) => ({ name: c.name, total: c.spent, count: c.count, recurring: false })),
      });
    }
    slices.sort((a, b) => b.total - a.total);
    return { slices, total: ranked.reduce((s2, c) => s2 + c.spent, 0), categoryCount: ranked.length };
  }, [byCategory, allMerchants, categories]);

  // ── what to fix ──────────────────────────────────────────────────────────
  const runAdvice = async () => {
    if (!tx.length) return;
    setAdvising(true);
    setError(null);
    try {
      const res = await fetch("/api/budget/advise", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period: month, month, currency,
          totals: { inflow: totals.inflow, outflow: totals.outflow, net: totals.net, transactions: tx.length },
          categories: byCategory.map((c) => ({ name: c.name, spent: Number(c.spent.toFixed(2)), budget: c.budget, count: c.count })),
          merchants: allMerchants.slice(0, 40).map((m) => ({ merchant: m.merchant, total: Number(m.total.toFixed(2)), count: m.count })),
          subscriptions: subRows.map((s) => ({ merchant: s.merchant, monthly: Number(s.monthly.toFixed(2)), count: s.count, status: s.status, kind: s.kind })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error || `Advice failed (${res.status}).`); return; }
      setAdvice({ headline: json.headline || "", findings: json.findings || [], quickWins: json.quickWins || [], generatedAt: json.generatedAt ?? null });
      setAdviceOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Advice failed.");
    } finally {
      setAdvising(false);
    }
  };

  const catOptions = useMemo(
    () => [{ value: "", label: "— none —" }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))],
    [categories]
  );
  const stagedIncluded = staged.filter((r) => r.include);
  const hasData = tx.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── Months that actually hold data ───────────────────────────────── */}
      {months.length > 0 && (
        <Card variant="classic" padding="10px 14px">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: TYPE.label, fontWeight: 800, letterSpacing: "0.14em", ...MUTED }}>STORED MONTHS</span>
            {months.map((m) => (
              <button
                key={m.month}
                onClick={() => onMonth?.(m.month)}
                title={`${m.n} transaction${m.n === 1 ? "" : "s"}`}
                style={{ ...pill(m.month === month), display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                {monthLabel(m.month)}
                <span style={{ fontSize: TYPE.micro, fontWeight: 900, opacity: 0.65 }}>{m.n}</span>
              </button>
            ))}
            {!months.some((m) => m.month === month) && (
              <span style={{ fontSize: TYPE.label, color: WARN }}>{monthLabel(month)} — nothing stored</span>
            )}
          </div>
        </Card>
      )}

      {/* ── WHAT TO FIX — first, because the conclusion is the point ──────── */}
      {hasData && (
        <Card variant="classic" padding={18} style={{ borderColor: rgba(WARN, 0.3) }}>
          {/* Header doubles as the collapse toggle. The savings total and the
              age of the stored pass stay visible when collapsed, so the card
              is still worth reading at one line tall. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span
              onClick={() => setAdviceOpen((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
            >
              <span style={{ fontSize: TYPE.label, ...MUTED }}>{adviceOpen ? "▾" : "▸"}</span>
              <span style={{ fontSize: TYPE.label, fontWeight: 900, letterSpacing: "0.18em", color: WARN }}>WHAT TO FIX</span>
            </span>
            <span style={{ fontSize: TYPE.label, ...MUTED }}>{monthLabel(month)}</span>
            {advice?.generatedAt && <span style={{ fontSize: TYPE.label, ...MUTED }}>· ran {sinceLabel(advice.generatedAt)}</span>}
            {potentialSavings > 0 && (
              <span style={{ fontSize: TYPE.label, fontWeight: 900, color: MONEY_IN, fontVariantNumeric: "tabular-nums" }}>
                {fmtMoney(potentialSavings, currency)}/mo identified
              </span>
            )}
            {!adviceOpen && advice && (
              <span style={{ fontSize: TYPE.label, ...MUTED }}>
                {advice.findings.length} finding{advice.findings.length === 1 ? "" : "s"}
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => void runAdvice()}
              disabled={advising}
              style={{ ...ghost(), padding: "6px 12px", fontSize: TYPE.label, opacity: advising ? 0.5 : 1, borderColor: rgba(WARN, 0.5), color: WARN }}
            >
              {advising ? "Thinking…" : advice ? "Re-run" : "✦ Analyze this month"}
            </button>
          </div>

          {adviceOpen && !advice && !advising && (
            <div style={{ fontSize: TYPE.body, ...MUTED, marginTop: 10, lineHeight: 1.5 }}>
              Reads the merchant totals, category totals and recurring charges below, then ranks what's actually costing you.
              Individual transactions are never sent.
            </div>
          )}
          {adviceOpen && advice?.headline && <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.35, marginTop: 12 }}>{advice.headline}</div>}

          {adviceOpen && advice && (
            <>
              <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                {advice.findings.map((f, i) => {
                  const ui = SEVERITY_UI[f.severity];
                  return (
                    <div
                      key={i}
                      style={{
                        border: `1px solid ${HOME_THEME.border}`,
                        borderLeft: `3px solid ${ui.color}`,
                        borderRadius: 12,
                        padding: "12px 14px",
                        background: `linear-gradient(90deg, ${rgba(ui.color, 0.07)} 0%, ${rgba("#ffffff", 0.02)} 45%)`,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: TYPE.micro, fontWeight: 900, letterSpacing: "0.14em", color: ui.color, border: `1px solid ${rgba(ui.color, 0.4)}`, background: rgba(ui.color, 0.1), borderRadius: 999, padding: "2px 8px" }}>{ui.label}</span>
                        <span style={{ fontSize: TYPE.subhead, fontWeight: 800 }}>{f.title}</span>
                        <div style={{ flex: 1 }} />
                        {f.monthlySavings > 0 && (
                          <span style={{ fontSize: TYPE.body, fontWeight: 900, color: MONEY_IN, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(f.monthlySavings, currency)}/mo</span>
                        )}
                      </div>
                      <div style={{ fontSize: TYPE.body, color: HOME_THEME.text, opacity: 0.82, lineHeight: 1.55, marginTop: 8 }}>{f.detail}</div>
                      {f.evidence && <div style={{ fontSize: TYPE.label, ...MUTED, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{f.evidence}</div>}
                    </div>
                  );
                })}
              </div>

              {advice.quickWins.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={labelCap()}>Quick wins</div>
                  <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
                    {advice.quickWins.map((qw, i) => <li key={i} style={{ fontSize: TYPE.body, color: HOME_THEME.text, opacity: 0.82, lineHeight: 1.5 }}>{qw}</li>)}
                  </ul>
                </div>
              )}
              <div style={{ fontSize: 11, ...MUTED, marginTop: 14, opacity: 0.55 }}>
                Built from the aggregates below — merchant totals, category totals, recurring hits.
                Saved against {monthLabel(month)}; it stays until you re-run.
              </div>
            </>
          )}
        </Card>
      )}

      {/* ── Stat strip ───────────────────────────────────────────────────── */}
      {hasData && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Tile label="Transactions" value={String(tx.length)} sub={monthLabel(month)} />
          <Tile label="Money out" value={fmtMoney(totals.outflow, currency)} sub={`${allMerchants.length} merchants`} valueColor={MONEY_OUT} />
          <Tile label="Money in" value={fmtMoney(totals.inflow, currency)} valueColor={MONEY_IN} />
          <Tile label="Net" value={fmtMoney(totals.net, currency)} valueColor={totals.net >= 0 ? MONEY_IN : MONEY_OUT} />
          <Tile label="Subscriptions" value={fmtMoney(totals.subTotal, currency)} sub={`${subRows.length} recurring · ${fmtMoney(totals.subTotal * 12, currency)}/yr`} valueColor={WARN} />
          <Tile label="Real bills" value={fmtMoney(totals.billTotal, currency)} sub={`${fmtMoney(totals.billTotal * 12, currency)}/yr · has to be paid`} valueColor={ACCENT} />
          <Tile
            label="Luxury"
            value={fmtMoney(totals.luxuryTotal, currency)}
            sub={totals.subTotal > 0
              ? `${Math.round((totals.luxuryTotal / totals.subTotal) * 100)}% of recurring${totals.untagged ? ` · ${totals.untagged} guessed` : ""}`
              : "nothing recurring"}
            valueColor={WARN}
          />
          <Tile label="If you cancel" value={fmtMoney(totals.cancelSavings, currency)} sub={totals.cancelSavings > 0 ? `${fmtMoney(totals.cancelSavings * 12, currency)}/yr back` : "nothing tagged cancel"} valueColor={totals.cancelSavings > 0 ? MONEY_IN : HOME_THEME.muted} />
        </div>
      )}

      {/* ── Unsaved category edits ───────────────────────────────────────── */}
      {pending.size > 0 && (
        <div
          style={{
            position: "sticky", top: 8, zIndex: 40,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            padding: "11px 16px", borderRadius: 14,
            border: `1px solid ${rgba(WARN, 0.55)}`,
            background: `linear-gradient(180deg, ${rgba(WARN, 0.16)}, ${rgba("#000000", 0.55)})`,
            backdropFilter: "blur(16px)",
            boxShadow: `0 10px 30px ${rgba("#000000", 0.45)}`,
          }}
        >
          <span style={{ fontSize: TYPE.label, fontWeight: 900, letterSpacing: "0.14em", color: WARN }}>UNSAVED</span>
          <span style={{ fontSize: TYPE.body, fontWeight: 700 }}>
            {pending.size} transaction{pending.size === 1 ? "" : "s"} re-filed
          </span>
          <span style={{ fontSize: TYPE.label, ...MUTED }}>The totals above already show it — nothing is stored until you save.</span>
          <div style={{ flex: 1 }} />
          {/* The default. A category is a fact about the merchant, so the same
              merchant in January gets the same answer — otherwise the trend is
              drawn from a history that disagrees with itself. Turned off only
              for a merchant that genuinely changed what it was. */}
          <label
            title="Apply each change to that merchant's rows in every month, not just this one"
            style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: TYPE.label, fontWeight: 800, letterSpacing: "0.06em", color: allMonths ? ACCENT : HOME_THEME.muted }}
          >
            <input
              type="checkbox"
              checked={allMonths}
              onChange={(e) => toggleAllMonths(e.target.checked)}
              style={{ accentColor: HOME_THEME.cyan, cursor: "pointer" }}
            />
            Apply to every month
          </label>
          <button onClick={() => setPending(new Map())} disabled={saving} style={ghost()}>Discard</button>
          <button onClick={() => void saveCategories()} disabled={saving} style={{ ...primary(), opacity: saving ? 0.5 : 1 }}>
            {saving ? "Saving…" : `Save ${pending.size} change${pending.size === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {/* ── View switch ──────────────────────────────────────────────────── */}
      {hasData && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {([["merchants", `Merchants (${allMerchants.length})`], ["donut", "Where it went"], ["ledger", `Ledger (${tx.length})`], ["categories", "Categories"], ["subs", `Subscriptions (${subRows.length})`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} style={pill(view === k)}>{l}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={() => void clearMonth()} disabled={saving} style={{ ...ghost(), color: HOME_THEME.red, borderColor: rgba(HOME_THEME.red, 0.35) }}>
            Clear {monthLabel(month)}
          </button>
        </div>
      )}

      {/* ── MERCHANTS — grouped under category, capped, searchable ───────── */}
      {hasData && view === "merchants" && (
        <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 16px 10px" }}>
            <div style={{ fontSize: TYPE.label, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: ACCENT }}>By merchant</div>
            <div style={{ fontSize: TYPE.label, ...MUTED, marginTop: 3, lineHeight: 1.45 }}>
              Every charge from one vendor merged into a single line, grouped under its category. One dropdown re-files the whole vendor.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter merchants…"
                style={{ ...field(), width: 240, maxWidth: "100%", padding: "7px 10px", fontSize: 13 }}
              />
              <button
                onClick={() => setOnlyUncat((v) => !v)}
                style={{ ...pill(onlyUncat), borderColor: onlyUncat ? rgba(WARN, 0.75) : HOME_THEME.border, color: onlyUncat ? WARN : HOME_THEME.text }}
              >
                Needs a category ({totals.uncategorized})
              </button>
              <button
                onClick={() => setCollapsedCats(collapsedCats.size ? new Set() : new Set(merchantGroups.map((g) => g.name)))}
                style={ghost()}
              >
                {collapsedCats.size ? "Expand all" : "Collapse all"}
              </button>
              <span style={{ fontSize: TYPE.label, ...MUTED }}>
                {visibleMerchants.length} of {allMerchants.length} merchants · {merchantGroups.length} categories
              </span>
            </div>
          </div>

          {merchantGroups.length === 0 && (
            <div style={{ padding: 20, ...MUTED, fontSize: TYPE.body }}>Nothing matches that filter.</div>
          )}

          {merchantGroups.map((g) => {
            const closed = collapsedCats.has(g.name);
            const showAll = showAllIn.has(g.name);
            const rows = showAll ? g.rows : g.rows.slice(0, PER_CAT_LIMIT);
            const hidden = g.rows.length - rows.length;
            return (
              <div key={g.name}>
                {/* Category band — click to fold the whole group away. */}
                <div
                  onClick={() => toggleIn(collapsedCats, setCollapsedCats, g.name)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                    padding: "9px 16px",
                    background: `linear-gradient(90deg, ${rgba(g.color, 0.14)} 0%, ${rgba("#ffffff", 0.02)} 60%)`,
                    borderTop: `1px solid ${HOME_THEME.border}`,
                    borderBottom: `1px solid ${rgba("#ffffff", 0.05)}`,
                  }}
                >
                  <span style={{ ...MUTED, fontSize: TYPE.label }}>{closed ? "▸" : "▾"}</span>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: g.color, flex: "none" }} />
                  <span style={{ fontWeight: 800, fontSize: TYPE.body }}>{g.name}</span>
                  <span style={{ fontSize: TYPE.label, ...MUTED }}>{g.rows.length} merchant{g.rows.length === 1 ? "" : "s"}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontWeight: 900, fontVariantNumeric: "tabular-nums", fontSize: TYPE.body }}>{fmtMoney(g.total, currency)}</span>
                </div>

                {!closed && (
                  <div style={isMobile ? scrollX : undefined}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 520 : undefined }}>
                    <tbody>
                      {rows.map((m) => {
                        const share = totals.outflow > 0 ? (m.total / totals.outflow) * 100 : 0;
                        const open = expanded.has(m.key);
                        return (
                          <Fragment key={m.key}>
                            <tr style={{ background: m.flagged ? rgba(WARN, 0.05) : undefined }}>
                              <td style={{ ...td("center"), width: 34, cursor: "pointer", ...MUTED }} onClick={() => toggleIn(expanded, setExpanded, m.key)}>
                                {open ? "▾" : "▸"}
                              </td>
                              <td style={{ ...td("left"), cursor: "pointer" }} onClick={() => toggleIn(expanded, setExpanded, m.key)}>
                                <div style={{ fontWeight: 700 }}>
                                  {m.merchant}
                                  {m.flagged && <span style={{ marginLeft: 6, color: WARN }}>🔁</span>}
                                  {m.mixedCategory && <span title="Rows in this vendor have different categories" style={{ marginLeft: 7, fontSize: TYPE.micro, fontWeight: 900, color: WARN, letterSpacing: "0.08em" }}>MIXED</span>}
                                </div>
                                <div style={{ height: 3, borderRadius: 99, background: rgba("#ffffff", 0.06), marginTop: 5, maxWidth: 240 }}>
                                  <div style={{ width: `${share}%`, height: 3, borderRadius: 99, background: g.color }} />
                                </div>
                              </td>
                              <td style={{ ...td("center"), width: 55, ...MUTED }}>{m.count}</td>
                              <td style={{ ...td("right"), width: 115, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(m.total, currency)}</td>
                              <td style={{ ...td("right"), width: 95, ...MUTED, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(m.total / m.count, currency)}</td>
                              <td style={{ ...td("left"), width: 190 }}>
                                {/* One dropdown re-files every transaction from
                                    this vendor — this month here and now, and,
                                    with "Apply to every month" on, the rest of
                                    history when you save. */}
                                <ThemedSelect
                                  value={m.categoryId == null || m.mixedCategory ? "" : String(m.categoryId)}
                                  onChange={(v) => setMerchantCategory(m.merchant, v ? Number(v) : null)}
                                  options={catOptions}
                                  placeholder={m.mixedCategory ? "mixed — set all" : "— none —"}
                                />
                              </td>
                            </tr>
                            {open && m.rows.map((r) => (
                              <tr key={`${m.key}-${r.id}`} style={{ background: rgba("#000000", 0.28) }}>
                                <td style={td("center")} />
                                <td style={{ ...td("left"), paddingLeft: 26, ...MUTED, fontSize: TYPE.label }} title={r.description}>
                                  <span style={{ marginRight: 8 }}>{shortDate(r.tx_date)}</span>
                                  {r.description}
                                </td>
                                <td style={td("center")} />
                                <td style={{ ...td("right"), fontVariantNumeric: "tabular-nums", ...MUTED }}>{fmtMoney(r.amount, currency)}</td>
                                <td style={td("center")}>
                                  <button onClick={() => void deleteTx(r.id)} title="Remove from Real Month" style={{ ...ghost(), padding: "3px 8px", fontSize: TYPE.label, ...MUTED }}>×</button>
                                </td>
                                <td style={td("left")}>
                                  <ThemedSelect
                                    value={r.category_id == null ? "" : String(r.category_id)}
                                    onChange={(v) => setTxCategory(r.id, v ? Number(v) : null)}
                                    options={catOptions}
                                  />
                                </td>
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })}
                      {hidden > 0 && (
                        <tr>
                          <td colSpan={6} style={{ ...td("left"), paddingLeft: 34 }}>
                            <button onClick={() => toggleIn(showAllIn, setShowAllIn, g.name)} style={{ ...ghost(), padding: "5px 11px", fontSize: TYPE.label, color: ACCENT, borderColor: rgba(ACCENT, 0.35) }}>
                              + {hidden} smaller merchant{hidden === 1 ? "" : "s"} ({fmtMoney(g.rows.slice(PER_CAT_LIMIT).reduce((s, m) => s + m.total, 0), currency)})
                            </button>
                          </td>
                        </tr>
                      )}
                      {showAll && g.rows.length > PER_CAT_LIMIT && (
                        <tr>
                          <td colSpan={6} style={{ ...td("left"), paddingLeft: 34 }}>
                            <button onClick={() => toggleIn(showAllIn, setShowAllIn, g.name)} style={{ ...ghost(), padding: "5px 11px", fontSize: TYPE.label, ...MUTED }}>Show fewer</button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {/* ── WHERE IT WENT — donut + expandable category rows ─────────────── */}
      {hasData && view === "donut" && (
        <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
          <SectionHead
            title="Where it went"
            sub="Hover or tap a segment to isolate it. Click a category to see the merchants inside it. Categories are drawn individually down to the point where whatever is left over is smaller than the smallest one shown — so Other, if it appears, is always the last slice."
          />
          <SpendDonut
            slices={donut.slices}
            total={donut.total}
            currency={currency}
            periodLabel={monthLabel(month)}
            categoryCount={donut.categoryCount}
            chargeCount={txView.filter((r) => r.direction === "out").length}
          />
        </Card>
      )}

      {/* ── LEDGER — flat and sortable ───────────────────────────────────── */}
      {hasData && view === "ledger" && (
        <Card variant="classic" padding={0} style={{ overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", flexWrap: "wrap" }}>
            <span style={{ fontSize: TYPE.label, ...MUTED, fontWeight: 800, letterSpacing: "0.1em" }}>SORT</span>
            {(["date", "merchant", "amount", "category"] as const).map((k) => (
              <button key={k} onClick={() => toggleSort(k)} style={pill(sortKey === k)}>
                {k[0].toUpperCase() + k.slice(1)}{sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </button>
            ))}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" style={{ ...field(), width: 200, maxWidth: "100%", padding: "7px 10px", fontSize: 13 }} />
            <button
              onClick={() => setOnlyUncat((v) => !v)}
              style={{ ...pill(onlyUncat), borderColor: onlyUncat ? rgba(WARN, 0.75) : HOME_THEME.border, color: onlyUncat ? WARN : HOME_THEME.text }}
            >
              Needs a category ({totals.uncategorized})
            </button>
          </div>
          <div style={isMobile ? scrollX : undefined}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 560 : undefined }}>
            <thead>
              <tr>
                <SortTh label="Date" k="date" width={70} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Merchant" k="merchant" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th style={th("left")}>As it read</th>
                <SortTh label="Category" k="category" width={190} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Amount" k="amount" align="right" width={110} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th style={{ ...th("center"), width: 50 }} />
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((r) => (
                <tr key={r.id} style={{ background: r.is_recurring ? rgba(WARN, 0.05) : undefined }}>
                  <td style={{ ...td("left"), ...MUTED }}>{shortDate(r.tx_date)}</td>
                  <td style={{ ...td("left"), fontWeight: 700 }}>
                    {r.merchant}{r.is_recurring === 1 && <span style={{ marginLeft: 6, color: WARN }}>🔁</span>}
                  </td>
                  <td style={{ ...td("left"), ...MUTED, fontSize: TYPE.label, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.description}>
                    {r.description}
                  </td>
                  <td style={td("left")}>
                    <ThemedSelect
                      value={r.category_id == null ? "" : String(r.category_id)}
                      onChange={(v) => setTxCategory(r.id, v ? Number(v) : null)}
                      options={catOptions}
                    />
                  </td>
                  <td style={{ ...td("right"), fontWeight: 800, fontVariantNumeric: "tabular-nums", color: r.direction === "out" ? MONEY_OUT : MONEY_IN }}>
                    {r.direction === "out" ? "−" : "+"}{fmtMoney(r.amount, currency)}
                  </td>
                  <td style={td("center")}>
                    <button onClick={() => void deleteTx(r.id)} title="Remove from Real Month" style={{ ...ghost(), padding: "4px 9px", fontSize: 13, ...MUTED }}>×</button>
                  </td>
                </tr>
              ))}
              {ledgerRows.length === 0 && (
                <tr><td colSpan={6} style={{ ...td("center"), ...MUTED, padding: 20 }}>Nothing matches.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {/* ── CATEGORIES ───────────────────────────────────────────────────────
          Three cards, widest lens first: every category across every imported
          month (with the budgets editable), then one category's history, then
          the single month you have loaded. */}
      {hasData && view === "categories" && (
        <CategoryBudgetSection
          month={month}
          categories={categories}
          currency={currency}
          trend={trend}
          months={months}
          onCategoriesChanged={onCategoriesChanged}
          onOpenCategories={onOpenCategories}
        />
      )}

      {hasData && view === "categories" && (
        <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
          <SectionHead title="This month by category" sub="Just the loaded month, with a transaction count per category — the two cards above put it in context." />
          {/* The fuel correction, spelled out. Without this the Sheetz number
              quietly disagrees with the ledger two clicks away, which reads as
              a bug rather than as the deduction it is. */}
          {fuelNote && (
            <div
              style={{
                display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
                margin: "0 16px 12px", padding: "10px 13px", borderRadius: 12,
                border: `1px solid ${rgba(ACCENT, 0.35)}`,
                background: rgba(ACCENT, 0.08),
                fontSize: TYPE.label, fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: ACCENT }}>Flex gas</span>
              <span style={{ fontSize: TYPE.body }}>
                <b>{fuelNote.fuelName}</b> {fmtMoney(fuelNote.gross, currency)} filed
                {" − "}<b style={{ color: WARN }}>{fmtMoney(fuelNote.moved, currency)}</b> Amazon Flex gas
                {" = "}<b>{fmtMoney(fuelNote.net, currency)}</b> real
              </span>
              <span style={MUTED}>
                {fuelNote.flexName
                  ? `Moved to ${fuelNote.flexName}, so the month still adds up.`
                  : "Subtracted only — add a Flex category to keep the month's totals whole."}
                {" "}From the Amazon tab, applied on every read — not at import.
              </span>
              {fuelNote.uncovered > 0.005 && (
                <span style={{ color: WARN }}>
                  {fmtMoney(fuelNote.uncovered, currency)} of Flex gas had nothing left in {fuelNote.fuelName} to come out of.
                </span>
              )}
            </div>
          )}
          <div style={isMobile ? scrollX : undefined}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 620 : undefined }}>
            <thead>
              <tr>
                <th style={th("left")}>Category</th>
                <th style={{ ...th("center"), width: 55 }}>×</th>
                <th style={{ ...th("right"), width: 120 }}>Spent</th>
                <th style={{ ...th("right"), width: 120 }}>Budget</th>
                <th style={{ ...th("right"), width: 130 }}>vs budget</th>
              </tr>
            </thead>
            <tbody>
              {byCategory.map((c) => {
                const delta = c.budget > 0 ? c.spent - c.budget : null;
                const pct = c.budget > 0 ? Math.min(100, (c.spent / c.budget) * 100) : 0;
                return (
                  <tr key={c.name}>
                    <td style={{ ...td("left"), fontWeight: 700 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color || HOME_THEME.cyan, flex: "none" }} />
                        {c.name}
                      </div>
                      {c.budget > 0 && (
                        <div style={{ height: 3, borderRadius: 99, background: rgba("#ffffff", 0.06), marginTop: 5, maxWidth: 220 }}>
                          <div style={{ width: `${pct}%`, height: 3, borderRadius: 99, background: (delta ?? 0) > 0 ? MONEY_OUT : MONEY_IN }} />
                        </div>
                      )}
                    </td>
                    <td style={{ ...td("center"), ...MUTED }}>{c.count}</td>
                    <td style={{ ...td("right"), fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(c.spent, currency)}</td>
                    <td style={{ ...td("right"), ...MUTED, fontVariantNumeric: "tabular-nums" }}>{c.budget > 0 ? fmtMoney(c.budget, currency) : "—"}</td>
                    <td style={{ ...td("right"), fontVariantNumeric: "tabular-nums", fontWeight: 700, color: delta == null ? HOME_THEME.muted : delta > 0 ? MONEY_OUT : MONEY_IN }}>
                      {delta == null ? "—" : `${delta > 0 ? "+" : ""}${fmtMoney(delta, currency)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {/* ── SUBSCRIPTIONS ────────────────────────────────────────────────── */}
      {/* Split by KIND, not listed flat. Nearly every repeat is tagged "keep",
          so a single ranked list says only "you spend money every month". The
          question underneath it is which of these you could actually stop —
          so real bills and luxuries are two tables with two totals, and the
          keep/watch/cancel verdict stays as an independent second axis. */}
      {hasData && view === "subs" && (
        <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
          <SectionHead
            title="Recurring charges"
            sub="Bill or luxury is what it IS; keep / watch / cancel is what you are doing about it. → Payments adds THAT subscription to the register as a monthly recurring rule — the only thing that ever crosses over."
            right={
              subRows.length ? (
                <div style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>
                    <span style={{ color: ACCENT }}>{fmtMoney(totals.billTotal, currency)}</span>
                    <span style={{ ...MUTED, fontWeight: 700 }}> bills · </span>
                    <span style={{ color: WARN }}>{fmtMoney(totals.luxuryTotal, currency)}</span>
                    <span style={{ ...MUTED, fontWeight: 700 }}> luxury</span>
                  </div>
                  <div style={{ fontSize: TYPE.label, ...MUTED }}>
                    per month{totals.untagged > 0 ? ` · ${totals.untagged} still a guess` : " · all tagged"}
                  </div>
                </div>
              ) : null
            }
          />
          {subRows.length === 0 ? (
            <div style={{ padding: 20, ...MUTED, fontSize: TYPE.body }}>Nothing in {monthLabel(month)} repeats at a steady amount.</div>
          ) : (
            (["bill", "luxury"] as const).map((kind) => {
              const rows = subRows.filter((r) => r.kind === kind);
              if (!rows.length) return null;
              const ui = KIND_UI[kind];
              const monthly = rows.reduce((a, r) => a + r.monthly, 0);
              const guesses = rows.filter((r) => r.kindGuessed).length;
              return (
                <div key={kind}>
                  <div
                    style={{
                      display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
                      padding: "12px 16px 10px",
                      borderTop: `1px solid ${HOME_THEME.border}`,
                      borderLeft: `3px solid ${ui.color}`,
                      background: `linear-gradient(90deg, ${rgba(ui.color, 0.13)}, transparent 70%)`,
                    }}
                  >
                    <span style={{ fontSize: TYPE.label, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: ui.color }}>
                      {ui.heading}
                    </span>
                    <span style={{ fontSize: TYPE.body, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>
                      {fmtMoney(monthly, currency)}<span style={{ ...MUTED, fontWeight: 700 }}> /mo</span>
                    </span>
                    <span style={{ fontSize: TYPE.label, ...MUTED }}>
                      {fmtMoney(monthly * 12, currency)}/yr · {rows.length} item{rows.length === 1 ? "" : "s"}
                      {guesses > 0 ? ` · ${guesses} guessed` : ""}
                    </span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: TYPE.label, ...MUTED }}>{ui.blurb}</span>
                  </div>
                  <div style={isMobile ? scrollX : undefined}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 860 : undefined }}>
                      <thead>
                        <tr>
                          <th style={th("left")}>Merchant</th>
                          <th style={{ ...th("center"), width: 55 }}>Hits</th>
                          <th style={{ ...th("right"), width: 105 }}>Each</th>
                          <th style={{ ...th("right"), width: 120 }}>Per year</th>
                          <th style={{ ...th("center"), width: 160 }}>Need</th>
                          <th style={{ ...th("center"), width: 210 }}>Verdict</th>
                          <th style={{ ...th("center"), width: 140 }}>Plan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((s) => (
                          <tr key={s.key} style={{ opacity: s.status === "cancel" ? 0.75 : 1 }}>
                            <td style={{ ...td("left"), fontWeight: 700, textDecoration: s.status === "cancel" ? "line-through" : undefined }}>
                              🔁 {s.merchant}
                              {s.categoryId != null && <span style={{ marginLeft: 8, fontSize: 11, ...MUTED }}>{catById.get(s.categoryId)?.name}</span>}
                            </td>
                            <td style={{ ...td("center"), ...MUTED }}>{s.count}</td>
                            <td style={{ ...td("right"), fontVariantNumeric: "tabular-nums" }}>{fmtMoney(s.each, currency)}</td>
                            <td style={{ ...td("right"), fontWeight: 800, color: ui.color, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(s.monthly * 12, currency)}</td>
                            <td style={td("center")}>
                              <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
                                {(["bill", "luxury"] as const).map((k) => {
                                  const on = s.kind === k;
                                  return (
                                    <button
                                      key={k}
                                      onClick={() => void setSubKind(s.merchant, k)}
                                      title={s.kindGuessed ? "Guessed from the merchant name — click to make it stick" : undefined}
                                      style={{
                                        ...chip(on, KIND_UI[k].color),
                                        // A guess looks like a guess. Nothing is
                                        // stored for this merchant until a click.
                                        borderStyle: on && s.kindGuessed ? "dashed" : "solid",
                                        opacity: on ? (s.kindGuessed ? 0.72 : 1) : 0.42,
                                      }}
                                    >
                                      {KIND_UI[k].label}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                            <td style={td("center")}>
                              <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
                                {(["keep", "watch", "cancel"] as const).map((st) => (
                                  <button key={st} onClick={() => void setSubStatus(s.merchant, st)} style={chip(s.status === st, STATUS_UI[st].color)}>
                                    {STATUS_UI[st].label}
                                  </button>
                                ))}
                              </div>
                            </td>
                            <td style={td("center")}>
                              {s.pushedId ? (
                                <span style={{ fontSize: TYPE.label, color: MONEY_IN, fontWeight: 800 }}>✓ In Payments</span>
                              ) : (
                                <button
                                  onClick={() => void pushToPayments(s.merchant, s.each)}
                                  title={`Add ${s.merchant} to Payments as a ${fmtMoney(s.each, currency)}/mo recurring rule`}
                                  style={{ ...ghost(), padding: "6px 11px", fontSize: TYPE.label, color: ACCENT, borderColor: rgba(ACCENT, 0.4) }}
                                >
                                  → Payments
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </Card>
      )}

      {loading && !hasData && <Card variant="classic" padding={20} style={MUTED}>Loading {monthLabel(month)}…</Card>}

      {/* ── Import ───────────────────────────────────────────────────────── */}
      <Card
        variant="classic"
        padding={20}
        style={{
          borderStyle: "dashed",
          borderColor: dragging ? rgba(HOME_THEME.cyan, 0.85) : HOME_THEME.border,
          transition: "border-color .15s ease, box-shadow .15s ease",
          boxShadow: dragging ? `0 0 40px ${rgba(HOME_THEME.cyan, 0.35)}` : undefined,
        }}
      >
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(e.dataTransfer.files); }}
        >
          <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", minWidth: 260 }}>
              <div style={{ fontSize: TYPE.title, fontWeight: 900, letterSpacing: "0.06em" }}>
                {parsing ? "Reading statement…" : hasData ? "Add another statement" : "Drop a statement CSV, PDF or screenshot"}
              </div>
              <div style={{ ...MUTED, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                Lands in Real Month only — <span style={{ color: ACCENT }}>Payments and Overview never see it</span>, so nothing double-counts.
                Re-importing an overlapping statement skips rows already stored.{" "}
                <span style={{ color: ACCENT }}>CSV is the accurate one</span> — the numbers are read straight from the columns, never guessed.
                {sourceName && !parsing ? <> Last read: <span style={{ color: ACCENT }}>{sourceName}</span>.</> : null}
              </div>
            </div>
            <div style={{ width: 150, maxWidth: "100%" }}>
              <div style={labelCap()}>Bank</div>
              <ThemedSelect value={bank} onChange={(v) => setBank(v as Bank)} options={BANKS.map((b) => ({ value: b, label: BANK_LABEL[b] }))} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", paddingBottom: 1 }}>
              <input ref={fileRef} type="file" accept=".csv,.tsv,text/csv,application/pdf,image/png,image/jpeg,image/webp" multiple onChange={(e) => void handleFiles(e.target.files)} style={{ display: "none" }} />
              <button onClick={() => fileRef.current?.click()} disabled={parsing} style={{ ...primary(), opacity: parsing ? 0.5 : 1 }}>
                {parsing ? "Parsing…" : "Choose file"}
              </button>
            </div>
          </div>
          {!categories.length && (
            <div style={{ marginTop: 12, fontSize: 13, color: WARN }}>
              No categories defined yet — rows will import uncategorized.{" "}
              {onOpenCategories && <span onClick={onOpenCategories} style={{ color: ACCENT, cursor: "pointer", textDecoration: "underline" }}>Add some first →</span>}
            </div>
          )}
          {error && <div style={{ marginTop: 12, fontSize: 13, color: HOME_THEME.red, fontWeight: 700 }}>{error}</div>}
          {notice && <div style={{ marginTop: 12, fontSize: 13, color: MONEY_IN, fontWeight: 700 }}>{notice}</div>}
        </div>
      </Card>

      {/* ── Staging: parsed but not yet saved ─────────────────────────────── */}
      {staged.length > 0 && (
        <Card variant="classic" padding={0} style={{ overflow: "hidden", borderColor: rgba(WARN, 0.45) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: TYPE.label, fontWeight: 900, letterSpacing: "0.16em", color: WARN }}>NOT SAVED YET</div>
              <div style={{ fontSize: 13, ...MUTED, marginTop: 3 }}>{stagedIncluded.length} of {staged.length} selected. Fix anything wrong, then save.</div>
            </div>
            <div style={{ flex: 1 }} />
            {/* Some exports write spending as positive and income as negative
                (Amex) and some do the reverse (Chase). When a CSV is one-sided
                the sign carries no information at all, so the server reads the
                descriptor — and this is the one click that fixes it when that
                reading came out backwards. */}
            <button
              onClick={() => setStaged((prev) => prev.map((r) => ({ ...r, direction: r.direction === "out" ? "in" : "out" })))}
              title="Swap in/out on every staged row — for an export whose signs are inverted"
              style={ghost()}
            >
              Flip all in/out
            </button>
            <button onClick={() => setStaged([])} style={ghost()}>Discard</button>
            <button onClick={() => void saveStaged()} disabled={saving || !stagedIncluded.length} style={{ ...primary(), opacity: saving || !stagedIncluded.length ? 0.5 : 1 }}>
              {saving ? "Saving…" : `Save ${stagedIncluded.length} to Real Month`}
            </button>
          </div>
          <div style={isMobile ? scrollX : undefined}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 640 : undefined }}>
            <thead>
              <tr>
                <th style={{ ...th("center"), width: 44 }}>
                  <input type="checkbox" checked={stagedIncluded.length === staged.length} onChange={(e) => setStaged((prev) => prev.map((r) => ({ ...r, include: e.target.checked })))} style={{ accentColor: HOME_THEME.cyan, cursor: "pointer" }} />
                </th>
                <th style={{ ...th("left"), width: 130 }}>Date</th>
                <th style={th("left")}>Merchant</th>
                <th style={th("left")}>As it read</th>
                <th style={{ ...th("left"), width: 170 }}>Category</th>
                <th style={{ ...th("right"), width: 110 }}>Amount</th>
                <th style={{ ...th("center"), width: 70 }}>Dir</th>
              </tr>
            </thead>
            <tbody>
              {staged.map((r) => (
                <tr key={r.key} style={{ opacity: r.include ? 1 : 0.4, background: r.recurring ? rgba(WARN, 0.05) : undefined }}>
                  <td style={td("center")}>
                    <input type="checkbox" checked={r.include} onChange={(e) => patchStaged(r.key, { include: e.target.checked })} style={{ accentColor: HOME_THEME.cyan, cursor: "pointer" }} />
                  </td>
                  <td style={td("left")}><input type="date" value={r.date} onChange={(e) => patchStaged(r.key, { date: e.target.value })} style={{ ...field(), padding: "5px 7px", fontSize: 13 }} /></td>
                  <td style={td("left")}><input value={r.merchant} onChange={(e) => patchStaged(r.key, { merchant: e.target.value })} style={{ ...field(), padding: "5px 8px", fontSize: 13, fontWeight: 700 }} /></td>
                  <td style={{ ...td("left"), ...MUTED, fontSize: TYPE.label, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.description}>
                    {r.description}{r.recurring && <span style={{ marginLeft: 6, color: WARN, fontWeight: 800 }}>🔁</span>}
                  </td>
                  <td style={td("left")}>
                    <ThemedSelect value={r.categoryId == null ? "" : String(r.categoryId)} onChange={(v) => patchStaged(r.key, { categoryId: v ? Number(v) : null })} options={catOptions} placeholder={r.categoryGuess || "— none —"} />
                  </td>
                  <td style={td("right")}><input type="number" value={r.amount} onChange={(e) => patchStaged(r.key, { amount: Math.abs(Number(e.target.value) || 0) })} style={{ ...field(), padding: "5px 8px", fontSize: 13, textAlign: "right" }} /></td>
                  <td style={td("center")}>
                    <button
                      onClick={() => patchStaged(r.key, { direction: r.direction === "out" ? "in" : "out" })} title="Toggle in / out"
                      style={{ ...ghost(), padding: "5px 10px", fontSize: TYPE.label, color: r.direction === "out" ? MONEY_OUT : MONEY_IN, borderColor: rgba(r.direction === "out" ? MONEY_OUT : MONEY_IN, 0.4) }}
                    >
                      {r.direction === "out" ? "− out" : "+ in"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {!loading && !hasData && staged.length === 0 && (
        <Card variant="classic" padding={28} style={{ textAlign: "center" }}>
          <div style={{ fontSize: TYPE.subhead, fontWeight: 800 }}>Nothing stored for {monthLabel(month)} yet</div>
          <div style={{ fontSize: 13, ...MUTED, marginTop: 6 }}>
            Drop that month's statement CSV, PDF or screenshot above, or pick a month that already has data from the chips at the top.
          </div>
        </Card>
      )}

      {/* An earlier build of this tab committed parsed rows into Payments,
          which double-counts against the plan. This undoes such a write. */}
      <UndoRegisterImport currency={currency} />
    </div>
  );
}

/**
 * Undo a bulk write into the Payments register.
 *
 * Rows are grouped by the minute they were INSERTed — a bulk import arrives as
 * one burst, a hand-typed row as its own 1-row group. Nothing deletes on the
 * first click: the button arms, showing how many rows and what they sum to.
 */
function UndoRegisterImport({ currency }: { currency: string }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [batches, setBatches] = useState<RegisterBatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/budget/register-imports?days=90", { cache: "no-store" });
      if (!res.ok) { setErr("Could not read the register's write history."); return; }
      const data = await res.json();
      setBatches((data.batches || []).map((b: RegisterBatch) => ({ ...b, total: Number(b.total), labels: b.labels || [] })));
    } catch {
      setErr("Could not read the register's write history.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { if (open && batches === null) void loadBatches(); }, [open, batches, loadBatches]);

  const remove = async (b: RegisterBatch) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/budget/register-imports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", from: b.first_at, to: b.last_at }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) { setErr(json?.error || "Remove failed."); return; }
      setMsg(`Removed ${json.removed} row${json.removed === 1 ? "" : "s"} from Payments. Reload the page to see Overview and Payments update.`);
      setArmed(null);
      await loadBatches();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Remove failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "14px 16px", cursor: "pointer", color: HOME_THEME.text }}>
        <span style={{ fontSize: TYPE.label, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", ...MUTED }}>
          {open ? "▾" : "▸"} Undo a Payments import
        </span>
        <div style={{ fontSize: TYPE.label, ...MUTED, marginTop: 3 }}>
          Remove rows that were bulk-written into the Payments register — grouped by when they landed.
        </div>
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {err && <div style={{ fontSize: 13, color: HOME_THEME.red, fontWeight: 700, marginBottom: 10 }}>{err}</div>}
          {msg && <div style={{ fontSize: 13, color: MONEY_IN, fontWeight: 700, marginBottom: 10 }}>{msg}</div>}
          {busy && !batches && <div style={{ fontSize: 13, ...MUTED }}>Reading write history…</div>}
          {batches && batches.length === 0 && <div style={{ fontSize: 13, ...MUTED }}>No register rows written in the last 90 days.</div>}
          {batches && batches.length > 0 && (
            <div style={isMobile ? scrollX : undefined}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 560 : undefined }}>
              <thead>
                <tr>
                  <th style={th("left")}>Written</th>
                  <th style={{ ...th("center"), width: 60 }}>Rows</th>
                  <th style={{ ...th("right"), width: 120 }}>Sum</th>
                  <th style={th("left")}>Covering</th>
                  <th style={{ ...th("right"), width: 200 }} />
                </tr>
              </thead>
              <tbody>
                {batches.map((b, i) => {
                  const isArmed = armed === b.bucket;
                  const bulk = b.n > 3;
                  return (
                    <tr key={b.bucket} style={{ background: i === 0 && bulk ? rgba(WARN, 0.06) : undefined }}>
                      <td style={{ ...td("left"), fontVariantNumeric: "tabular-nums" }}>
                        {b.bucket.replace("T", " ").slice(0, 16)}
                        {i === 0 && bulk && <span style={{ marginLeft: 8, fontSize: TYPE.micro, fontWeight: 900, color: WARN, letterSpacing: "0.1em" }}>MOST RECENT</span>}
                      </td>
                      <td style={{ ...td("center"), fontWeight: 800, color: bulk ? WARN : HOME_THEME.muted, opacity: bulk ? 1 : 0.62 }}>{b.n}</td>
                      <td style={{ ...td("right"), fontWeight: 800, fontVariantNumeric: "tabular-nums", color: b.total < 0 ? MONEY_OUT : MONEY_IN }}>{fmtMoney(b.total, currency)}</td>
                      <td style={{ ...td("left"), fontSize: TYPE.label, ...MUTED }}>
                        <div>{b.from_date} → {b.to_date}</div>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300, opacity: 0.8 }}>
                          {b.labels.join(", ")}{b.n > b.labels.length ? " …" : ""}
                        </div>
                      </td>
                      <td style={td("right")}>
                        {isArmed ? (
                          <span style={{ display: "inline-flex", gap: 6 }}>
                            <button onClick={() => void remove(b)} disabled={busy} style={{ ...ghost(), padding: "6px 11px", fontSize: TYPE.label, color: HOME_THEME.red, borderColor: rgba(HOME_THEME.red, 0.6), background: rgba(HOME_THEME.red, 0.12) }}>
                              {busy ? "…" : `Yes, delete ${b.n}`}
                            </button>
                            <button onClick={() => setArmed(null)} style={{ ...ghost(), padding: "6px 11px", fontSize: TYPE.label }}>Cancel</button>
                          </span>
                        ) : (
                          <button onClick={() => { setArmed(b.bucket); setMsg(null); }} style={{ ...ghost(), padding: "6px 11px", fontSize: TYPE.label, ...MUTED }}>Remove</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
          <div style={{ fontSize: 11, ...MUTED, marginTop: 12, opacity: 0.6, lineHeight: 1.5 }}>
            Grouped by the minute each row was written, so one bulk import is one line and a hand-typed row is its own 1-row line.
            Beginning-balance rows are never listed and never deleted. Recurring rules aren't rows, so they're untouched.
          </div>
        </div>
      )}
    </Card>
  );
}

/** A column header that sorts the ledger, with an arrow on the active key. */
function SortTh({ label, k, sortKey, sortDir, onSort, align = "left", width }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void; align?: "left" | "right" | "center"; width?: number;
}) {
  const active = sortKey === k;
  return (
    <th
      onClick={() => onSort(k)}
      title={`Sort by ${label.toLowerCase()}`}
      style={{ ...th(align), width, cursor: "pointer", color: active ? ACCENT : HOME_THEME.muted, opacity: active ? 1 : 0.65, userSelect: "none" }}
    >
      {label}{active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
}

function Tile({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <Card variant="classic" padding="12px 14px">
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", ...MUTED }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4, color: valueColor || HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: TYPE.label, ...MUTED, marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}

function SectionHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "flex-start", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: TYPE.label, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: ACCENT }}>{title}</div>
        {sub && <div style={{ fontSize: TYPE.label, ...MUTED, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}
