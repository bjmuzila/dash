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

/**
 * Budget → Real Month.
 *
 * What actually cleared, read off a bank/card statement PDF or screenshot and
 * stored in budget_statement_tx — a table Overview and Payments never touch.
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
const DONUT_RAMP = ["#006e9f", "#7583e0", "#834790", "#d06480", "#9b4803", "#a68a00", "#347426", "#00a698"];
/** Neutral, reserved for the folded tail and for Uncategorized. */
const DONUT_NEUTRAL = "#6b7480";
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
  status: SubStatus; note: string | null; pushed_recurring_id: number | null;
};

type MonthStat = { month: string; n: number };

/** One (month, category) spend total — the Categories-tab trend series. */
type TrendPoint = { month: string; categoryId: number | null; spent: number; count: number };

type Finding = { title: string; severity: "high" | "medium" | "low"; detail: string; monthlySavings: number; evidence: string };
type Advice = { headline: string; findings: Finding[]; quickWins: string[]; generatedAt?: string | null };

type View = "merchants" | "donut" | "ledger" | "categories" | "budget" | "subs";
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
const UNCATEGORIZED = "Uncategorized";
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
function mKey(v: string): string {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
}
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
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  /** Which category the trend line is drawing. null until the data picks one. */
  const [trendCat, setTrendCat] = useState<string | null>(null);
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
      for (const file of list) {
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        const isImg = file.type.startsWith("image/");
        if (!isPdf && !isImg) { setError(`${file.name} isn't a PDF or an image — skipped.`); hitError = true; continue; }
        if (file.size > 25 * 1024 * 1024) { setError(`${file.name} is over 25 MB — split it and try again.`); hitError = true; continue; }

        const data = await fileToBase64(file);
        const res = await fetch("/api/budget/parse-statement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: isPdf ? "pdf" : "image", data,
            mediaType: file.type || (isPdf ? "application/pdf" : "image/png"),
            categories: categories.map((c) => ({ id: c.id, name: c.name })),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json?.error || `Parse failed (${res.status}).`); hitError = true; continue; }

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
      if (added) setNotice(`Read ${added} transaction${added === 1 ? "" : "s"}. Check them, then save.`);
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
      setNotice(`Saved ${json.inserted} to Real Month${json.skipped ? ` · ${json.skipped} already there (skipped)` : ""}. Payments and Overview are untouched.`);
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
    const changes = [...pending.entries()].map(([id, categoryId]) => ({ id, categoryId }));
    try {
      const out = await post({ action: "setCategoriesBulk", changes });
      if (!out?.ok) { setError("Categories did not save — nothing was changed."); return; }
      setPending(new Map());
      setNotice(`Saved ${out.updated} categor${out.updated === 1 ? "y" : "ies"}.`);
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
    return [...map.values()].sort((a, b) => b.spent - a.spent);
  }, [txView, catById]);

  /** Months that actually have a statement behind them. Everything below uses
      this to tell "no data" apart from "spent nothing" — the two are the same
      zero in the totals and mean opposite things. */
  const importedMonths = useMemo(() => new Set(months.map((m) => m.month)), [months]);

  // ── category trend: one category's spend, month over month ───────────────
  // The Categories table answers "how did this month go". This answers the
  // question that follows it — "is that normal?" — which the table cannot,
  // because a single month has no shape.
  const catTrend = useMemo(() => {
    // The axis is built from the CALENDAR, not from the months that happen to
    // have rows. A month with no statement imported has to read as a gap in
    // the line, not get quietly closed up so the curve looks continuous.
    const ry = Number(month.slice(0, 4));
    const rm = Number(month.slice(5, 7));
    const all: string[] = [];
    if (Number.isFinite(ry) && Number.isFinite(rm)) {
      for (let k = 11; k >= 0; k--) {
        const d = new Date(Date.UTC(ry, rm - 1 - k, 1));
        all.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
      }
    }

    const nameOf = (id: number | null) => (id == null ? UNCATEGORIZED : catById.get(id)?.name || UNCATEGORIZED);
    const byName = new Map<string, Map<string, number>>();
    for (const p of trend) {
      const n = nameOf(p.categoryId);
      const slot = byName.get(n) ?? new Map<string, number>();
      slot.set(p.month, (slot.get(p.month) ?? 0) + p.spent);
      byName.set(n, slot);
    }

    // Trim the empty run on the left. Two months of imported statements
    // stretched across a full year of empty slots is unreadable.
    const anyIn = (m2: string) => [...byName.values()].some((v) => (v.get(m2) ?? 0) > 0);
    const first = all.findIndex(anyIn);
    const axis = first < 0 ? all.slice(-1) : all.slice(first);

    // Hue is bound to the category's stable id order, exactly like the donut,
    // so a category is the same colour on both charts.
    const slotOf = new Map<string, number>();
    [...categories].sort((a, b) => a.id - b.id).forEach((c, i) => slotOf.set(c.name, i % DONUT_RAMP.length));

    // The divisor for every average on this page: months with a statement
    // behind them. NOT months where this category happened to see spend —
    // that would be the average size of a Travel trip, when what a budget
    // asks is the average Travel cost PER MONTH, quiet months included.
    // And not the whole axis either, since an unimported month is unknown,
    // not zero.
    const importedN = axis.filter((m) => importedMonths.has(m)).length || 1;

    const series = [...byName.entries()]
      .map(([name, slot]) => {
        const values = axis.map((mm) => slot.get(mm) ?? 0);
        const total = values.reduce((s, v) => s + v, 0);
        const cat = categories.find((c) => c.name === name);
        return {
          name,
          values,
          total,
          avg: total / importedN,
          months: importedN,
          budget: cat?.amount ?? 0,
          color: cat?.color || (name === UNCATEGORIZED ? DONUT_NEUTRAL : DONUT_RAMP[slotOf.get(name) ?? 0]),
        };
      })
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total);

    return { months: axis, series };
  }, [trend, catById, categories, month, importedMonths]);

  /** The drawn category — the picked one, or the biggest until one is picked. */
  const trendActive = useMemo(
    () => catTrend.series.find((s) => s.name === trendCat) ?? catTrend.series[0] ?? null,
    [catTrend, trendCat]
  );

  // ── budget vs actual, month by month ─────────────────────────────────────
  // Every category with a budget gets a row whether or not it saw spend this
  // month — a category you budgeted for and did not touch is a result, and
  // dropping the row hides it.
  const budgetGrid = useMemo(() => {
    const axis = catTrend.months;
    const bySeries = new Map(catTrend.series.map((s) => [s.name, s]));
    const names = new Set<string>([...categories.map((c) => c.name), ...bySeries.keys()]);

    const slotOf = new Map<string, number>();
    [...categories].sort((a, b) => a.id - b.id).forEach((c, i) => slotOf.set(c.name, i % DONUT_RAMP.length));

    const rows = [...names].map((name) => {
      const s = bySeries.get(name);
      const cat = categories.find((c) => c.name === name);
      const values = s?.values ?? axis.map(() => 0);
      // Same per-imported-month average the trend chart draws, so the two
      // views can never disagree about what a category costs.
      const avg = s?.avg ?? 0;
      const budget = cat?.amount ?? 0;
      const ratio = budget > 0 ? avg / budget : null;
      // Judged on the AVERAGE, never on the latest month. One expensive week
      // is not a broken budget, and a row that flips red every time a
      // quarterly bill lands teaches you to stop reading the colour.
      const status: BudgetStatus =
        ratio == null ? "none"
          : ratio <= 0.6 ? "crushed"
            : ratio <= 1 ? "ontrack"
              : ratio <= 1.15 ? "watch"
                : "over";
      return {
        name,
        id: cat?.id ?? null,
        color: cat?.color || s?.color || (name === UNCATEGORIZED ? DONUT_NEUTRAL : DONUT_RAMP[slotOf.get(name) ?? 0]),
        period: (cat as { period?: string } | undefined)?.period ?? "monthly",
        values, avg, budget, ratio, status,
        total: values.reduce((a, b) => a + b, 0),
      };
    });

    // Budgeted rows first, biggest budget down; unbudgeted noise last.
    rows.sort((a, b) => (b.budget - a.budget) || (b.total - a.total) || a.name.localeCompare(b.name));

    const counted = rows.filter((r) => r.status !== "none");
    return {
      axis,
      rows,
      good: counted.filter((r) => r.status === "ontrack" || r.status === "crushed").length,
      watch: counted.filter((r) => r.status === "watch").length,
      over: counted.filter((r) => r.status === "over").length,
    };
  }, [catTrend, categories]);

  /** Persist one category's budget. Upserts on name, so the row keeps its id,
      colour and period — this is the same write the Categories tab makes. */
  const saveBudget = useCallback(async (row: { name: string; budget: number; color: string; period: string }, amount: number) => {
    const res = await fetch("/api/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "category", name: row.name, amount, period: row.period, color: row.color }),
    });
    if (!res.ok) throw new Error("save failed");
    await onCategoriesChanged?.();
  }, [onCategoriesChanged]);

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
        return {
          merchant: m.merchant, key: m.key, count: m.count,
          each: repeats ? median : m.total, total: m.total,
          monthly: repeats ? median : m.total,
          categoryId: m.categoryId,
          status: (saved?.status ?? "watch") as SubStatus,
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
      if (i === -1) return [...prev, { id: -Date.now(), merchant_key: key, merchant, status, note: null, pushed_recurring_id: null }];
      const next = [...prev];
      next[i] = { ...next[i], status };
      return next;
    });
    await post({ action: "setSubscription", merchant, status });
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
    return { outflow, inflow, net: inflow - outflow, uncategorized, subTotal, cancelSavings };
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
          subscriptions: subRows.map((s) => ({ merchant: s.merchant, monthly: Number(s.monthly.toFixed(2)), count: s.count, status: s.status })),
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
          <button onClick={() => setPending(new Map())} disabled={saving} style={ghost()}>Discard</button>
          <button onClick={() => void saveCategories()} disabled={saving} style={{ ...primary(), opacity: saving ? 0.5 : 1 }}>
            {saving ? "Saving…" : `Save ${pending.size} change${pending.size === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {/* ── View switch ──────────────────────────────────────────────────── */}
      {hasData && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {([["merchants", `Merchants (${allMerchants.length})`], ["donut", "Where it went"], ["ledger", `Ledger (${tx.length})`], ["categories", "Categories"], ["budget", "Budget"], ["subs", `Subscriptions (${subRows.length})`]] as const).map(([k, l]) => (
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
                style={{ ...field(), width: 240, padding: "7px 10px", fontSize: 13 }}
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
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
                                {/* One dropdown re-files every transaction from this vendor. */}
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
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" style={{ ...field(), width: 200, padding: "7px 10px", fontSize: 13 }} />
            <button
              onClick={() => setOnlyUncat((v) => !v)}
              style={{ ...pill(onlyUncat), borderColor: onlyUncat ? rgba(WARN, 0.75) : HOME_THEME.border, color: onlyUncat ? WARN : HOME_THEME.text }}
            >
              Needs a category ({totals.uncategorized})
            </button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
        </Card>
      )}

      {/* ── CATEGORIES ───────────────────────────────────────────────────── */}
      {hasData && view === "categories" && catTrend.series.length > 0 && (
        <CategoryTrend
          axis={catTrend.months}
          imported={importedMonths}
          series={catTrend.series}
          active={trendActive}
          onPick={setTrendCat}
          currency={currency}
        />
      )}

      {hasData && view === "categories" && (
        <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
          <SectionHead title="By category" sub="Real spend against the budgets on the Categories tab." />
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
        </Card>
      )}

      {/* ── BUDGET vs ACTUAL ─────────────────────────────────────────────── */}
      {hasData && view === "budget" && (
        <BudgetGrid
          grid={budgetGrid}
          imported={importedMonths}
          currency={currency}
          onSave={saveBudget}
          onOpenCategories={onOpenCategories}
        />
      )}

      {/* ── SUBSCRIPTIONS ────────────────────────────────────────────────── */}
      {hasData && view === "subs" && (
        <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
          <SectionHead
            title="Recurring charges"
            sub="Tag each one. → Payments adds THAT subscription to the register as a monthly recurring rule — the only thing that ever crosses over."
          />
          {subRows.length === 0 ? (
            <div style={{ padding: 20, ...MUTED, fontSize: TYPE.body }}>Nothing in {monthLabel(month)} repeats at a steady amount.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th("left")}>Merchant</th>
                  <th style={{ ...th("center"), width: 55 }}>Hits</th>
                  <th style={{ ...th("right"), width: 105 }}>Each</th>
                  <th style={{ ...th("right"), width: 120 }}>Per year</th>
                  <th style={{ ...th("center"), width: 210 }}>Verdict</th>
                  <th style={{ ...th("center"), width: 140 }}>Plan</th>
                </tr>
              </thead>
              <tbody>
                {subRows.map((s) => (
                  <tr key={s.key} style={{ opacity: s.status === "cancel" ? 0.75 : 1 }}>
                    <td style={{ ...td("left"), fontWeight: 700, textDecoration: s.status === "cancel" ? "line-through" : undefined }}>
                      🔁 {s.merchant}
                      {s.categoryId != null && <span style={{ marginLeft: 8, fontSize: 11, ...MUTED }}>{catById.get(s.categoryId)?.name}</span>}
                    </td>
                    <td style={{ ...td("center"), ...MUTED }}>{s.count}</td>
                    <td style={{ ...td("right"), fontVariantNumeric: "tabular-nums" }}>{fmtMoney(s.each, currency)}</td>
                    <td style={{ ...td("right"), fontWeight: 800, color: WARN, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(s.monthly * 12, currency)}</td>
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
                {parsing ? "Reading statement…" : hasData ? "Add another statement" : "Drop a statement PDF or screenshot"}
              </div>
              <div style={{ ...MUTED, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                Lands in Real Month only — <span style={{ color: ACCENT }}>Payments and Overview never see it</span>, so nothing double-counts.
                Re-importing an overlapping statement skips rows already stored.
                {sourceName && !parsing ? <> Last read: <span style={{ color: ACCENT }}>{sourceName}</span>.</> : null}
              </div>
            </div>
            <div style={{ width: 150 }}>
              <div style={labelCap()}>Bank</div>
              <ThemedSelect value={bank} onChange={(v) => setBank(v as Bank)} options={BANKS.map((b) => ({ value: b, label: BANK_LABEL[b] }))} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", paddingBottom: 1 }}>
              <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple onChange={(e) => void handleFiles(e.target.files)} style={{ display: "none" }} />
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
            <button onClick={() => setStaged([])} style={ghost()}>Discard</button>
            <button onClick={() => void saveStaged()} disabled={saving || !stagedIncluded.length} style={{ ...primary(), opacity: saving || !stagedIncluded.length ? 0.5 : 1 }}>
              {saving ? "Saving…" : `Save ${stagedIncluded.length} to Real Month`}
            </button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
        </Card>
      )}

      {!loading && !hasData && staged.length === 0 && (
        <Card variant="classic" padding={28} style={{ textAlign: "center" }}>
          <div style={{ fontSize: TYPE.subhead, fontWeight: 800 }}>Nothing stored for {monthLabel(month)} yet</div>
          <div style={{ fontSize: 13, ...MUTED, marginTop: 6 }}>
            Drop that month's statement above, or pick a month that already has data from the chips at the top.
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
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
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

// ── budget vs actual ────────────────────────────────────────────────────────

type BudgetStatus = "crushed" | "ontrack" | "watch" | "over" | "none";
type BudgetRow = {
  name: string; id: number | null; color: string; period: string;
  values: number[]; avg: number; budget: number; ratio: number | null;
  status: BudgetStatus; total: number;
};

const BUDGET_STATUS_UI: Record<BudgetStatus, { label: string; color: string }> = {
  crushed: { label: "CRUSHED IT", color: MONEY_IN },
  ontrack: { label: "ON TRACK", color: HOME_THEME.green },
  watch: { label: "WATCH IT", color: WARN },
  over: { label: "OVER BUDGET", color: MONEY_OUT },
  none: { label: "NO BUDGET", color: HOME_THEME.muted },
};

/** Compact money for a dense grid: no cents, they never survive a 12-wide row. */
function gridMoney(v: number, currency: string): string {
  return fmtMoney(v, currency).replace(/\.\d+$/, "");
}

/**
 * Budget vs actual — every category across the imported months, with the
 * monthly budget editable in place.
 *
 * Status is judged on the AVERAGE, not on the latest month. One expensive
 * week is not a broken budget, and a row that flips to red every time a
 * quarterly bill lands teaches you to ignore the colour.
 *
 * The edit writes through to budget_categories (upsert on name), which is the
 * same row the Categories tab edits — so a budget set here is the budget
 * everywhere, not a copy living in this browser.
 */
function BudgetGrid({
  grid, imported, currency, onSave, onOpenCategories,
}: {
  grid: { axis: string[]; rows: BudgetRow[]; good: number; watch: number; over: number };
  imported: Set<string>;
  currency: string;
  onSave: (row: { name: string; budget: number; color: string; period: string }, amount: number) => Promise<void>;
  onOpenCategories?: () => void;
}) {
  /** Keystrokes live here; nothing is written until blur or Enter. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const commit = async (row: BudgetRow) => {
    const raw = draft[row.name];
    if (raw == null) return;
    const amount = Math.max(0, Number(raw.replace(/[^0-9.]/g, "")) || 0);
    setDraft((d) => { const n = { ...d }; delete n[row.name]; return n; });
    if (amount === row.budget) return;
    setBusy(row.name);
    setErr(null);
    try {
      await onSave({ name: row.name, budget: row.budget, color: row.color, period: row.period }, amount);
    } catch {
      setErr(`Could not save the budget for ${row.name}.`);
    } finally {
      setBusy(null);
    }
  };

  const tile = (label: string, value: number, color: string) => (
    <Card variant="classic" padding="12px 14px" style={{ flex: "1 1 180px", borderColor: rgba(color, 0.35), background: `linear-gradient(180deg, ${rgba(color, 0.1)}, ${rgba("#000000", 0.25)})` }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color, opacity: 0.9 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, marginTop: 2, color: HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </Card>
  );

  const cell: React.CSSProperties = {
    padding: "8px 10px", textAlign: "right", fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    borderBottom: `1px solid ${rgba("#ffffff", 0.05)}`,
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {tile("On track / under", grid.good, HOME_THEME.green)}
        {tile("Watch it", grid.watch, WARN)}
        {tile("Over budget", grid.over, MONEY_OUT)}
      </div>

      <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
        <SectionHead
          title="Budget vs actual"
          sub="Monthly budget is editable here and saves to the category itself. Status reads the average, not the last month."
          right={
            onOpenCategories && (
              <button onClick={onOpenCategories} style={ghost()}>Manage categories</button>
            )
          }
        />
        {err && (
          <div style={{ margin: "0 16px 10px", padding: "8px 12px", borderRadius: 10, fontSize: TYPE.label, color: MONEY_OUT, border: `1px solid ${rgba(MONEY_OUT, 0.4)}`, background: rgba(MONEY_OUT, 0.1) }}>
            {err}
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...th("left"), position: "sticky", left: 0, background: HOME_THEME.panel, zIndex: 2 }}>Category</th>
                <th style={{ ...th("center"), width: 108 }}>Budget/mo</th>
                {grid.axis.map((m) => (
                  <th key={m} style={{ ...th("right"), width: 70, fontSize: 10 }}>{axisMonth(m).toUpperCase()}</th>
                ))}
                <th style={{ ...th("right"), width: 80 }}>Avg</th>
                <th style={{ ...th("center"), width: 130 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((r) => {
                const ui = BUDGET_STATUS_UI[r.status];
                const tint = r.status === "over" ? rgba(MONEY_OUT, 0.07)
                  : r.status === "watch" ? rgba(WARN, 0.06)
                    : "transparent";
                return (
                  <tr key={r.name} style={{ background: tint }}>
                    <td style={{ ...td("left"), position: "sticky", left: 0, background: tint === "transparent" ? HOME_THEME.panel : "transparent", zIndex: 1, fontWeight: 700 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: r.color, flex: "none" }} />
                        {r.name}
                      </div>
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      {r.id == null ? (
                        <span style={{ ...MUTED, fontSize: 11 }}>—</span>
                      ) : (
                        <input
                          value={draft[r.name] ?? (r.budget > 0 ? String(Math.round(r.budget)) : "")}
                          onChange={(e) => setDraft((d) => ({ ...d, [r.name]: e.target.value }))}
                          onBlur={() => void commit(r)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          inputMode="decimal"
                          placeholder="—"
                          disabled={busy === r.name}
                          style={{
                            ...field(), width: 78, textAlign: "right", padding: "5px 8px",
                            fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                            opacity: busy === r.name ? 0.5 : 1,
                          }}
                        />
                      )}
                    </td>
                    {r.values.map((v, i) => {
                      const known = imported.has(grid.axis[i]);
                      const overThisMonth = r.budget > 0 && v > r.budget;
                      return (
                        <td
                          key={grid.axis[i]}
                          style={{
                            ...cell,
                            color: !known || v === 0 ? HOME_THEME.muted
                              : overThisMonth ? MONEY_OUT : HOME_THEME.text,
                            opacity: !known || v === 0 ? 0.4 : 1,
                            fontWeight: overThisMonth ? 800 : 600,
                          }}
                          title={known ? `${axisMonth(grid.axis[i])} · ${gridMoney(v, currency)}` : "No statement imported"}
                        >
                          {!known ? "·" : v === 0 ? "—" : gridMoney(v, currency)}
                        </td>
                      );
                    })}
                    <td style={{ ...cell, fontWeight: 900, color: r.budget > 0 && r.avg > r.budget ? MONEY_OUT : HOME_THEME.text }}>
                      {r.avg > 0 ? gridMoney(r.avg, currency) : "—"}
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      <span style={{
                        display: "inline-block", padding: "3px 9px", borderRadius: 999,
                        fontSize: 10, fontWeight: 900, letterSpacing: "0.07em",
                        color: ui.color,
                        border: `1px solid ${rgba(ui.color, 0.45)}`,
                        background: rgba(ui.color, 0.12),
                      }}>
                        {ui.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {grid.rows.length === 0 && (
                <tr><td colSpan={grid.axis.length + 4} style={{ ...td("center"), ...MUTED, padding: 20 }}>No categories yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── category trend ──────────────────────────────────────────────────────────

/** One category's month-over-month spend, with its own average. */
type TrendSeries = {
  name: string; values: number[]; total: number;
  avg: number; months: number; budget: number; color: string;
};

/** Axis label: "Jan", but a January carries its year so a 12-month window
    that straddles New Year doesn't silently restart. */
function axisMonth(m: string): string {
  const mm = Number(m.slice(5, 7));
  const short = new Date(2000, (Number.isFinite(mm) ? mm : 1) - 1, 1).toLocaleDateString("en-US", { month: "short" });
  return mm === 1 ? `${short} '${m.slice(2, 4)}` : short;
}

/** Round a max up to something a human would put on an axis. */
function niceMax(v: number): number {
  if (!(v > 0)) return 100;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 4 ? 4 : n <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * Catmull-Rom through the points, at low tension.
 *
 * Tension is deliberately 0.18 rather than the usual 0.5: a spend series is
 * spiky, and a lively spline overshoots between two far-apart points, drawing
 * a peak in a month that never had one.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} l 0.01 0`;
  const T = 0.18;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) * T, c1y = p1.y + (p2.y - p0.y) * T;
    const c2x = p2.x - (p3.x - p1.x) * T, c2y = p2.y - (p3.y - p1.y) * T;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/**
 * Category trend — one category's spend, month over month.
 *
 * The table below it is a single month, which cannot answer the question that
 * immediately follows every single-month number: is that normal? This draws
 * the same category across the imported history, with its own average as the
 * reference line and its budget as a second one.
 *
 * A month with NO statement imported BREAKS the line instead of plotting a
 * zero. An unimported month and a month where you genuinely spent nothing are
 * indistinguishable in the totals, and drawing the first as the second invents
 * a cliff that never happened.
 */
function CategoryTrend({
  axis, imported, series, active, onPick, currency,
}: {
  axis: string[];
  imported: Set<string>;
  series: TrendSeries[];
  active: TrendSeries | null;
  onPick: (name: string) => void;
  currency: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const s = active;

  const W = 880, H = 300, PADL = 62, PADR = 16, PADT = 16, PADB = 30;
  const n = Math.max(axis.length, 1);
  const plotW = W - PADL - PADR;
  const plotH = H - PADT - PADB;

  const top = niceMax(Math.max(s ? Math.max(...s.values) : 0, s?.budget ?? 0, 1) * 1.08);
  const px = (i: number) => (n === 1 ? PADL + plotW / 2 : PADL + (i / (n - 1)) * plotW);
  const py = (v: number) => PADT + plotH - (Math.min(v, top) / top) * plotH;

  // Runs of consecutive imported months. Each run is its own path, which is
  // what puts the gap in the line rather than a straight leap across it.
  const runs = useMemo(() => {
    const out: { i: number; x: number; y: number; v: number }[][] = [];
    let cur: { i: number; x: number; y: number; v: number }[] = [];
    axis.forEach((m, i) => {
      if (!imported.has(m)) { if (cur.length) out.push(cur); cur = []; return; }
      cur.push({ i, x: px(i), y: py(s?.values[i] ?? 0), v: s?.values[i] ?? 0 });
    });
    if (cur.length) out.push(cur);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis, imported, s, top]);

  if (!s) return null;

  const gid = `catTrendFill-${s.name.replace(/[^a-z0-9]/gi, "")}`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * (1 - f));
  const last = s.values[s.values.length - 1] ?? 0;
  const vsAvg = s.avg > 0 ? last - s.avg : 0;
  const hoverM = hover != null ? axis[hover] : null;
  const hoverV = hover != null ? s.values[hover] ?? 0 : 0;
  const hoverKnown = hoverM ? imported.has(hoverM) : false;

  return (
    <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
      <SectionHead
        title="Category trend"
        sub="Spend per month for one category, against its own average. A break in the line is a month with no statement imported."
        right={
          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: s.color, fontVariantNumeric: "tabular-nums" }}>
              {fmtMoney(hover != null && hoverKnown ? hoverV : last, currency)}
            </div>
            <div style={{ fontSize: TYPE.label, ...MUTED }}>
              {hover != null && hoverM ? axisMonth(hoverM) : "this month"}
              {hover == null && s.avg > 0 && (
                <> · <span style={{ color: vsAvg > 0 ? MONEY_OUT : MONEY_IN }}>{vsAvg > 0 ? "+" : ""}{fmtMoney(vsAvg, currency)}</span> vs avg</>
              )}
            </div>
          </div>
        }
      />

      {/* category picker */}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", padding: "0 16px 12px" }}>
        {series.map((c) => (
          <button
            key={c.name}
            onClick={() => onPick(c.name)}
            style={{
              padding: "6px 13px", borderRadius: 999, cursor: "pointer",
              fontSize: 12, fontWeight: 800,
              display: "inline-flex", alignItems: "center", gap: 7,
              border: `1px solid ${c.name === s.name ? rgba(c.color, 0.8) : HOME_THEME.border}`,
              background: c.name === s.name
                ? `linear-gradient(180deg, ${rgba(c.color, 0.3)}, ${rgba(c.color, 0.1)})`
                : rgba("#ffffff", 0.03),
              boxShadow: c.name === s.name ? `0 0 20px ${rgba(c.color, 0.35)}` : "none",
              color: HOME_THEME.text,
              opacity: c.name === s.name ? 1 : 0.72,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 3, background: c.color, flex: "none" }} />
            {c.name}
          </button>
        ))}
      </div>

      <div style={{ padding: "0 8px 6px" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" aria-label={`${s.name} spend by month`}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.34} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* value grid */}
          {ticks.map((t, i) => {
            const y = py(t);
            return (
              <g key={i}>
                <line x1={PADL} x2={W - PADR} y1={y} y2={y} stroke={rgba("#ffffff", 0.07)} strokeDasharray="4 5" />
                <text x={PADL - 10} y={y + 3.5} textAnchor="end" fontSize={10} fill={HOME_THEME.muted} opacity={0.62}>
                  {fmtMoney(t, currency).replace(/\.\d+$/, "")}
                </text>
              </g>
            );
          })}

          {/* budget line — the target this category was given */}
          {s.budget > 0 && s.budget <= top && (
            <>
              <line x1={PADL} x2={W - PADR} y1={py(s.budget)} y2={py(s.budget)} stroke={rgba(WARN, 0.55)} strokeDasharray="7 5" />
              <text x={W - PADR} y={py(s.budget) - 5} textAnchor="end" fontSize={9} fontWeight={800} fill={WARN} opacity={0.85}>
                BUDGET {fmtMoney(s.budget, currency).replace(/\.\d+$/, "")}
              </text>
            </>
          )}

          {/* the category's own average */}
          {s.avg > 0 && (
            <>
              <line x1={PADL} x2={W - PADR} y1={py(s.avg)} y2={py(s.avg)} stroke={rgba("#ffffff", 0.34)} strokeDasharray="2 4" />
              <text x={PADL + 4} y={py(s.avg) - 5} fontSize={9} fontWeight={800} fill={HOME_THEME.muted}>
                AVG {fmtMoney(s.avg, currency).replace(/\.\d+$/, "")}
              </text>
            </>
          )}

          {/* one path per unbroken run of imported months */}
          {runs.map((run, ri) => {
            const line = smoothPath(run);
            const area = run.length > 1
              ? `${line} L ${run[run.length - 1].x.toFixed(1)} ${PADT + plotH} L ${run[0].x.toFixed(1)} ${PADT + plotH} Z`
              : "";
            return (
              <g key={ri}>
                {area && <path d={area} fill={`url(#${gid})`} />}
                <path d={line} fill="none" stroke={rgba(s.color, 0.4)} strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" />
                <path d={line} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}

          {/* points + hover targets */}
          {runs.flat().map((p) => (
            <circle
              key={p.i}
              cx={p.x} cy={p.y} r={hover === p.i ? 5.5 : 3.5}
              fill={hover === p.i ? s.color : rgba("#000000", 0.85)}
              stroke={s.color} strokeWidth={2}
            />
          ))}
          {axis.map((_, i) => (
            <rect
              key={i}
              x={px(i) - plotW / (2 * Math.max(n - 1, 1))} y={PADT}
              width={plotW / Math.max(n - 1, 1)} height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
          ))}
          {hover != null && hoverKnown && (
            <line x1={px(hover)} x2={px(hover)} y1={PADT} y2={PADT + plotH} stroke={rgba(s.color, 0.35)} strokeDasharray="3 4" />
          )}

          {/* month axis */}
          <g fontSize={10} textAnchor="middle" fill={HOME_THEME.muted}>
            {axis.map((m, i) => (
              <text key={m} x={px(i)} y={H - 9} opacity={hover === i ? 1 : 0.62} fontWeight={hover === i ? 800 : 600}>
                {axisMonth(m)}
              </text>
            ))}
          </g>
        </svg>
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "4px 16px 14px", fontSize: TYPE.label }}>
        <span style={MUTED}>Average <b style={{ color: HOME_THEME.text }}>{fmtMoney(s.avg, currency)}</b> / mo</span>
        <span style={MUTED}>Highest <b style={{ color: HOME_THEME.text }}>{fmtMoney(Math.max(...s.values), currency)}</b></span>
        <span style={MUTED}>Total <b style={{ color: HOME_THEME.text }}>{fmtMoney(s.total, currency)}</b> over {s.months} imported mo</span>
        {s.budget > 0 && (
          <span style={MUTED}>
            Budget <b style={{ color: s.avg > s.budget ? MONEY_OUT : MONEY_IN }}>{fmtMoney(s.budget, currency)}</b> / mo
          </span>
        )}
      </div>
    </Card>
  );
}
