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
import { MoneyFlowSankey, type FlowNode, type FlowLink } from "./MoneyFlowSankey";

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
 *   Flow       — Sankey: money in → categories → merchants.
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

/** Category swatch ramp — theme tokens only, cycled for the flow diagram. */
const RAMP = [HOME_THEME.cyan, ACCENT, WARN, HOME_THEME.orange, RETA_PALETTE.rose, RETA_PALETTE.peach, HOME_THEME.green, RETA_PALETTE.green];

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

type Finding = { title: string; severity: "high" | "medium" | "low"; detail: string; monthlySavings: number; evidence: string };
type Advice = { headline: string; findings: Finding[]; quickWins: string[]; generatedAt?: string | null };

type View = "merchants" | "flow" | "ledger" | "categories" | "subs";
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
}: {
  /** YYYY-MM, driven by the month picker at the top of the Budget page. */
  month: string;
  /** Lets the month chips drive the page's picker. */
  onMonth?: (m: string) => void;
  categories: Category[];
  currency: string;
  defaultBank?: Bank;
  onOpenCategories?: () => void;
}) {
  const [tx, setTx] = useState<StoredTx[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [months, setMonths] = useState<MonthStat[]>([]);
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

  const setTxCategory = async (id: number, categoryId: number | null) => {
    setTx((prev) => prev.map((r) => (r.id === id ? { ...r, category_id: categoryId } : r)));
    await post({ action: "setTxCategory", id, categoryId });
  };

  /** Re-file every row from one merchant in a single call. */
  const setMerchantCategory = async (merchant: string, categoryId: number | null) => {
    const key = mKey(merchant);
    setTx((prev) => prev.map((r) => (mKey(r.merchant || r.description) === key ? { ...r, category_id: categoryId } : r)));
    const out = await post({ action: "setMerchantCategory", month, merchant, categoryId });
    if (out?.ok) {
      const name = categoryId == null ? "no category" : catById.get(categoryId)?.name ?? "that category";
      setNotice(`${out.updated} ${merchant} row${out.updated === 1 ? "" : "s"} → ${name}.`);
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
    for (const r of tx) {
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
  }, [tx, catById]);

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
    for (const r of tx) {
      if (r.direction !== "out") continue;
      const cat = r.category_id != null ? catById.get(r.category_id) : undefined;
      const name = cat?.name || UNCATEGORIZED;
      const k = name.toLowerCase();
      const hit = map.get(k);
      if (hit) { hit.spent += r.amount; hit.count += 1; }
      else map.set(k, { name, spent: r.amount, count: 1, budget: cat?.amount ?? 0, color: cat?.color ?? null });
    }
    return [...map.values()].sort((a, b) => b.spent - a.spent);
  }, [tx, catById]);

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
    let base = onlyUncat ? tx.filter((r) => r.category_id == null) : tx;
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
  }, [tx, sortKey, sortDir, onlyUncat, catById, q]);

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
    const outflow = tx.filter((r) => r.direction === "out").reduce((s, r) => s + r.amount, 0);
    const inflow = tx.filter((r) => r.direction === "in").reduce((s, r) => s + r.amount, 0);
    const uncategorized = tx.filter((r) => r.direction === "out" && r.category_id == null).length;
    const subTotal = subRows.reduce((s, m) => s + m.monthly, 0);
    const cancelSavings = subRows.filter((s) => s.status === "cancel").reduce((s, m) => s + m.monthly, 0);
    return { outflow, inflow, net: inflow - outflow, uncategorized, subTotal, cancelSavings };
  }, [tx, subRows]);

  const potentialSavings = useMemo(
    () => (advice?.findings ?? []).reduce((s, f) => s + (f.monthlySavings || 0), 0),
    [advice]
  );

  // ── Sankey: money in → category → merchant ───────────────────────────────
  // Merchants below the per-category cut are folded into one "Other" band so
  // the diagram stays readable at 60+ vendors.
  const flow = useMemo(() => {
    const nodes: FlowNode[] = [];
    const links: FlowLink[] = [];
    const cats = byCategory.filter((c) => c.spent > 0);
    if (!cats.length) return { nodes, links };

    const inflowValue = totals.inflow > 0 ? totals.inflow : totals.outflow;
    nodes.push({ id: "in", label: totals.inflow > 0 ? "Money in" : "Spending", value: inflowValue, color: MONEY_IN, col: 0 });

    cats.forEach((c, i) => {
      const color = c.color || (c.name === UNCATEGORIZED ? HOME_THEME.muted : RAMP[i % RAMP.length]);
      const id = `cat:${c.name}`;
      nodes.push({ id, label: c.name, value: c.spent, color, col: 1 });
      links.push({ source: "in", target: id, value: c.spent });

      const inCat = allMerchants.filter((m) => m.categoryName === c.name).sort((a, b) => b.total - a.total);
      const top = inCat.slice(0, 5);
      const rest = inCat.slice(5);
      for (const m of top) {
        const mid = `m:${c.name}:${m.merchant}`;
        nodes.push({ id: mid, label: m.merchant, value: m.total, color, col: 2 });
        links.push({ source: id, target: mid, value: m.total });
      }
      const restTotal = rest.reduce((s, m) => s + m.total, 0);
      if (restTotal > 0) {
        const mid = `m:${c.name}:other`;
        nodes.push({ id: mid, label: `Other (${rest.length})`, value: restTotal, color: rgba(color, 0.5), col: 2 });
        links.push({ source: id, target: mid, value: restTotal });
      }
    });

    if (totals.inflow > totals.outflow) {
      nodes.push({ id: "cat:__left", label: "Left over", value: totals.inflow - totals.outflow, color: MONEY_IN, col: 1 });
      links.push({ source: "in", target: "cat:__left", value: totals.inflow - totals.outflow });
    }
    return { nodes, links };
  }, [byCategory, allMerchants, totals]);

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

      {/* ── View switch ──────────────────────────────────────────────────── */}
      {hasData && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {([["merchants", `Merchants (${allMerchants.length})`], ["flow", "Flow"], ["ledger", `Ledger (${tx.length})`], ["categories", "Categories"], ["subs", `Subscriptions (${subRows.length})`]] as const).map(([k, l]) => (
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
                                  onChange={(v) => void setMerchantCategory(m.merchant, v ? Number(v) : null)}
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
                                    onChange={(v) => void setTxCategory(r.id, v ? Number(v) : null)}
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

      {/* ── FLOW ─────────────────────────────────────────────────────────── */}
      {hasData && view === "flow" && (
        <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
          <SectionHead
            title="Money flow"
            sub="Left to right: what came in, which categories absorbed it, and the vendors inside each one."
          />
          <MoneyFlowSankey
            nodes={flow.nodes}
            links={flow.links}
            currency={currency}
            height={Math.max(340, Math.min(900, flow.nodes.filter((n) => n.col === 2).length * 26 + 80))}
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
                      onChange={(v) => void setTxCategory(r.id, v ? Number(v) : null)}
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

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ padding: "14px 16px 10px" }}>
      <div style={{ fontSize: TYPE.label, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: ACCENT }}>{title}</div>
      {sub && <div style={{ fontSize: TYPE.label, ...MUTED, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
}
