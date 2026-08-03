import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME } from "../../lib/theme";
import { ThemedSelect } from "../../components/ThemedSelect";

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
 * the plan automatically.
 *
 * The one bridge is per-subscription: the → Payments button on a single
 * detected subscription creates one monthly recurring rule in the register.
 * One item, one deliberate click. There is no bulk commit, by design.
 *
 * Views:
 *   Ledger      — every stored transaction, category editable inline.
 *   Where it went — merchant rollup + category rollup against your budgets.
 *   Subscriptions — repeat charges, each tagged Keep / Cancel / Watch.
 *
 * Style note: this file re-declares the page-local surface tokens from
 * Budget.tsx rather than importing them (they are module-private there). Keep
 * the two in sync if the palette moves.
 */

// ── page-local surface tokens (mirrors Budget.tsx) ──────────────────────────
const PANEL = "#0B101B";
const HAIRLINE = "rgba(255,255,255,0.16)";
const EDGE_LIGHT = "inset 0 1px 0 rgba(255,255,255,0.12)";
const CARD_SHADOW = `${EDGE_LIGHT}, 0 2px 4px rgba(0,0,0,0.6), 0 24px 60px -16px rgba(0,0,0,0.75)`;
const LIGHT_BLUE = "#7dd3fc";
const GREEN = "#34D399";
const GOLD = "#FBBF24";

function card(): React.CSSProperties {
  return {
    background: `linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 34%), ${PANEL}`,
    borderRadius: 16,
    border: `1px solid ${HAIRLINE}`,
    boxShadow: CARD_SHADOW,
  };
}
function field(): React.CSSProperties {
  return {
    padding: "10px 12px", borderRadius: 10, border: `1px solid ${HAIRLINE}`,
    background: "rgba(0,0,0,0.45)", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.45)",
    color: HOME_THEME.text, outline: "none", width: "100%", fontSize: 14,
    colorScheme: "dark", accentColor: HOME_THEME.cyan,
    appearance: "none", WebkitAppearance: "none", MozAppearance: "textfield" as const,
  };
}
function labelCap(): React.CSSProperties {
  return { fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em", color: HOME_THEME.muted, marginBottom: 6 };
}
function primary(): React.CSSProperties {
  return {
    padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(33,158,188,0.60)",
    background: "linear-gradient(180deg, rgba(33,158,188,0.30), rgba(33,158,188,0.08))",
    boxShadow: "0 0 24px rgba(33,158,188,0.40), inset 0 1px 0 rgba(255,255,255,0.12)",
    color: LIGHT_BLUE, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em",
    cursor: "pointer", whiteSpace: "nowrap",
  };
}
function ghost(): React.CSSProperties {
  return {
    padding: "10px 14px", borderRadius: 10, border: `1px solid ${HAIRLINE}`,
    background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    color: HOME_THEME.text, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap",
  };
}
function pill(active: boolean): React.CSSProperties {
  return {
    padding: "7px 14px", borderRadius: 999,
    border: active ? "1px solid rgba(33,158,188,0.75)" : `1px solid ${HAIRLINE}`,
    background: active ? "linear-gradient(180deg, rgba(33,158,188,0.30), rgba(33,158,188,0.10))" : "rgba(255,255,255,0.03)",
    boxShadow: active ? "0 0 22px rgba(33,158,188,0.50), inset 0 1px 0 rgba(255,255,255,0.10)" : "none",
    color: active ? HOME_THEME.cyan : "rgba(255,255,255,0.82)",
    fontSize: 13, fontWeight: 800, cursor: "pointer",
  };
}
/** Small tri-state chip used by the Keep / Cancel / Watch selector. */
function chip(active: boolean, color: string): React.CSSProperties {
  return {
    padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 900, letterSpacing: "0.08em",
    border: `1px solid ${active ? color : HAIRLINE}`,
    background: active ? `${color}22` : "rgba(255,255,255,0.02)",
    color: active ? color : "rgba(255,255,255,0.5)",
    cursor: "pointer", textTransform: "uppercase",
  };
}
function th(align: "left" | "right" | "center"): React.CSSProperties {
  return {
    textAlign: align, padding: "10px 14px", color: HOME_THEME.muted, fontWeight: 800,
    fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em",
    borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap",
  };
}
function td(align: "left" | "right" | "center"): React.CSSProperties {
  return { textAlign: align, padding: "8px 14px", fontSize: 14, borderBottom: "1px solid rgba(255,255,255,0.05)" };
}

// ── types ───────────────────────────────────────────────────────────────────
type Bank = "coastal" | "truist" | "secu";
type Category = { id: number; name: string; amount: number; color?: string | null };
type SubStatus = "keep" | "cancel" | "watch";

/** A transaction parsed from a statement but not yet saved. */
type StagedRow = {
  key: string;
  date: string;
  description: string;
  merchant: string;
  amount: number;
  direction: "in" | "out";
  categoryId: number | null;
  categoryGuess: string;
  recurring: boolean;
  include: boolean;
};

/** A transaction as it lives in budget_statement_tx. */
type StoredTx = {
  id: number;
  month: string;
  tx_date: string;
  description: string;
  merchant: string;
  amount: number;
  direction: "in" | "out";
  category_id: number | null;
  is_recurring: number;
  bank: Bank;
  source: string | null;
};

type Subscription = {
  id: number;
  merchant_key: string;
  merchant: string;
  status: SubStatus;
  note: string | null;
  pushed_recurring_id: number | null;
};

type Finding = { title: string; severity: "high" | "medium" | "low"; detail: string; monthlySavings: number; evidence: string };
type Advice = { headline: string; findings: Finding[]; quickWins: string[] };

type View = "ledger" | "where" | "subs";
type SortKey = "date" | "merchant" | "amount" | "category";

/** One burst of INSERTs into budget_register, as seen by the undo panel. */
type RegisterBatch = {
  bucket: string;
  first_at: string;
  last_at: string;
  n: number;
  total: number;
  from_date: string;
  to_date: string;
  labels: string[];
};

const BANKS: Bank[] = ["coastal", "truist", "secu"];
const BANK_LABEL: Record<Bank, string> = { coastal: "COASTAL", truist: "TRUIST", secu: "SECU" };

const SEVERITY_UI: Record<Finding["severity"], { color: string; label: string }> = {
  high: { color: HOME_THEME.red, label: "HIGH" },
  medium: { color: GOLD, label: "MEDIUM" },
  low: { color: LIGHT_BLUE, label: "LOW" },
};
const STATUS_UI: Record<SubStatus, { color: string; label: string }> = {
  keep: { color: GREEN, label: "Keep" },
  cancel: { color: HOME_THEME.red, label: "Cancel" },
  watch: { color: GOLD, label: "Watch" },
};

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount || 0);
}
function shortDate(iso: string): string {
  const [, m, d] = String(iso).split("-").map(Number);
  return Number.isFinite(m) && Number.isFinite(d) ? `${m}/${d}` : String(iso);
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
  categories,
  currency,
  defaultBank = "secu",
  onOpenCategories,
}: {
  /** YYYY-MM, driven by the month picker at the top of the Budget page. */
  month: string;
  categories: Category[];
  currency: string;
  defaultBank?: Bank;
  onOpenCategories?: () => void;
}) {
  const [tx, setTx] = useState<StoredTx[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [view, setView] = useState<View>("ledger");
  // Ledger sorting. Sorting by merchant puts every charge from one vendor
  // together, which is the fast way to fix a whole merchant's categories.
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
    } catch {
      setError("Could not load this month's statement data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
    setAdvice(null);
    setStaged([]);
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
            kind: isPdf ? "pdf" : "image",
            data,
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          month,
          source: sourceName,
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
        `Saved ${json.inserted} to Real Month${json.skipped ? ` · ${json.skipped} already there (skipped)` : ""}. Payments and Overview are untouched.`
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

  const setTxCategory = async (id: number, categoryId: number | null) => {
    setTx((prev) => prev.map((r) => (r.id === id ? { ...r, category_id: categoryId } : r)));
    await post({ action: "setTxCategory", id, categoryId });
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

  /** Re-file every row from one merchant at once. */
  const setMerchantCategory = async (merchant: string, categoryId: number | null) => {
    const key = mKey(merchant);
    setTx((prev) => prev.map((r) => (mKey(r.merchant || r.description) === key ? { ...r, category_id: categoryId } : r)));
    const out = await post({ action: "setMerchantCategory", month, merchant, categoryId });
    if (out?.ok) {
      const name = categoryId == null ? "no category" : catById.get(categoryId)?.name ?? "that category";
      setNotice(`${out.updated} ${merchant} row${out.updated === 1 ? "" : "s"} → ${name}.`);
    }
  };

  // Ledger rows, sorted and optionally narrowed to the ones still unfiled.
  const ledgerRows = useMemo(() => {
    const base = onlyUncat ? tx.filter((r) => r.category_id == null) : tx;
    const dir = sortDir === "asc" ? 1 : -1;
    const catName = (r: StoredTx) => (r.category_id == null ? "\uffff" : catById.get(r.category_id)?.name ?? "\uffff");
    return [...base].sort((a2, b2) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a2.tx_date.localeCompare(b2.tx_date);
      else if (sortKey === "amount") cmp = a2.amount - b2.amount;
      else if (sortKey === "merchant") cmp = mKey(a2.merchant).localeCompare(mKey(b2.merchant));
      else cmp = catName(a2).localeCompare(catName(b2));
      // Within a merchant or category run, keep it chronological — otherwise
      // the grouped block reads as noise.
      if (cmp === 0 && sortKey !== "date") cmp = a2.tx_date.localeCompare(b2.tx_date);
      return cmp * dir;
    });
  }, [tx, sortKey, sortDir, onlyUncat, catById]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  // ── merchant rollup ──────────────────────────────────────────────────────
  const merchants = useMemo(() => {
    const map = new Map<string, { merchant: string; total: number; count: number; categoryId: number | null; amounts: number[]; flagged: boolean }>();
    for (const r of tx) {
      if (r.direction !== "out") continue;
      const k = mKey(r.merchant || r.description);
      const hit = map.get(k);
      if (hit) {
        hit.total += r.amount;
        hit.count += 1;
        hit.amounts.push(r.amount);
        hit.flagged = hit.flagged || r.is_recurring === 1;
        if (hit.categoryId == null) hit.categoryId = r.category_id;
      } else {
        map.set(k, { merchant: r.merchant || r.description, total: r.amount, count: 1, categoryId: r.category_id, amounts: [r.amount], flagged: r.is_recurring === 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [tx]);

  // ── category rollup vs the budgets on the Categories tab ─────────────────
  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; spent: number; count: number; budget: number; color: string | null }>();
    for (const r of tx) {
      if (r.direction !== "out") continue;
      const cat = r.category_id != null ? catById.get(r.category_id) : undefined;
      const name = cat?.name || "Uncategorized";
      const k = name.toLowerCase();
      const hit = map.get(k);
      if (hit) { hit.spent += r.amount; hit.count += 1; }
      else map.set(k, { name, spent: r.amount, count: 1, budget: cat?.amount ?? 0, color: cat?.color ?? null });
    }
    return [...map.values()].sort((a, b) => b.spent - a.spent);
  }, [tx, catById]);

  // ── subscriptions ────────────────────────────────────────────────────────
  // A merchant is recurring when Claude flagged it during the parse, or it hit
  // 2+ times this month at within 5% of the same amount. The saved verdict
  // (keep/cancel/watch) is joined in by merchant key so it survives re-imports.
  const subRows = useMemo(() => {
    const byKey = new Map(subs.map((s) => [s.merchant_key, s]));
    return merchants
      .map((m) => {
        const sorted = [...m.amounts].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] || 0;
        const tight = median > 0 && m.amounts.every((a) => Math.abs(a - median) <= median * 0.05);
        const repeats = m.count >= 2 && tight;
        if (!repeats && !m.flagged) return null;
        const saved = byKey.get(mKey(m.merchant));
        // A repeat charge bills at the median; a once-a-month flagged charge is
        // just its own amount.
        const monthly = repeats ? median : m.total;
        return {
          merchant: m.merchant,
          key: mKey(m.merchant),
          count: m.count,
          each: repeats ? median : m.total,
          total: m.total,
          monthly,
          categoryId: m.categoryId,
          status: (saved?.status ?? "watch") as SubStatus,
          pushedId: saved?.pushed_recurring_id ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.monthly - a.monthly);
  }, [merchants, subs]);

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

  /** The single bridge into the plan — one subscription, one recurring rule. */
  const pushToPayments = async (merchant: string, amount: number) => {
    const anchor = `${month}-01`;
    const out = await post({ action: "pushSubscription", merchant, amount, bank, anchorDate: anchor, status: "keep" });
    if (!out?.ok) return;
    setNotice(`${merchant} added to Payments as a monthly recurring rule (${fmtMoney(amount, currency)}). Nothing else was copied over.`);
    const res = await fetch(`/api/budget/real?month=${month}`, { cache: "no-store" });
    if (res.ok) { const d = await res.json(); setSubs(d.subscriptions || []); }
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

  // ── what to fix ──────────────────────────────────────────────────────────
  const runAdvice = async () => {
    if (!tx.length) return;
    setAdvising(true);
    setError(null);
    try {
      const res = await fetch("/api/budget/advise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period: month,
          currency,
          totals: { inflow: totals.inflow, outflow: totals.outflow, net: totals.net, transactions: tx.length },
          categories: byCategory.map((c) => ({ name: c.name, spent: Number(c.spent.toFixed(2)), budget: c.budget, count: c.count })),
          merchants: merchants.slice(0, 40).map((m) => ({ merchant: m.merchant, total: Number(m.total.toFixed(2)), count: m.count })),
          subscriptions: subRows.map((s) => ({ merchant: s.merchant, monthly: Number(s.monthly.toFixed(2)), count: s.count, status: s.status })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error || `Advice failed (${res.status}).`); return; }
      setAdvice({ headline: json.headline || "", findings: json.findings || [], quickWins: json.quickWins || [] });
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── Dropzone ─────────────────────────────────────────────────────── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(e.dataTransfer.files); }}
        style={{
          ...card(), padding: 20, borderStyle: "dashed",
          borderColor: dragging ? "rgba(33,158,188,0.85)" : HAIRLINE,
          boxShadow: dragging ? "0 0 40px rgba(33,158,188,0.35), inset 0 1px 0 rgba(255,255,255,0.12)" : CARD_SHADOW,
          transition: "border-color .15s ease, box-shadow .15s ease",
        }}
      >
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px", minWidth: 260 }}>
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "0.06em" }}>
              {parsing ? "Reading statement…" : "Drop a statement PDF or screenshot"}
            </div>
            <div style={{ color: HOME_THEME.muted, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              Lands in Real Month only — <span style={{ color: LIGHT_BLUE }}>Payments and Overview never see it</span>, so nothing double-counts.
              Re-importing an overlapping statement skips rows already stored.
              {sourceName && !parsing ? <> Last read: <span style={{ color: LIGHT_BLUE }}>{sourceName}</span>.</> : null}
            </div>
          </div>
          <div style={{ width: 150 }}>
            <div style={labelCap()}>Bank</div>
            <ThemedSelect value={bank} onChange={(v) => setBank(v as Bank)} options={BANKS.map((b) => ({ value: b, label: BANK_LABEL[b] }))} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", paddingBottom: 1 }}>
            <input
              ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple
              onChange={(e) => void handleFiles(e.target.files)} style={{ display: "none" }}
            />
            <button onClick={() => fileRef.current?.click()} disabled={parsing} style={{ ...primary(), opacity: parsing ? 0.5 : 1 }}>
              {parsing ? "Parsing…" : "Choose file"}
            </button>
          </div>
        </div>
        {!categories.length && (
          <div style={{ marginTop: 12, fontSize: 13, color: GOLD }}>
            No categories defined yet — rows will import uncategorized.{" "}
            {onOpenCategories && (
              <span onClick={onOpenCategories} style={{ color: LIGHT_BLUE, cursor: "pointer", textDecoration: "underline" }}>Add some first →</span>
            )}
          </div>
        )}
        {error && <div style={{ marginTop: 12, fontSize: 13, color: HOME_THEME.red, fontWeight: 700 }}>{error}</div>}
        {notice && <div style={{ marginTop: 12, fontSize: 13, color: GREEN, fontWeight: 700 }}>{notice}</div>}
      </div>

      {/* ── Staging: parsed but not yet saved ─────────────────────────────── */}
      {staged.length > 0 && (
        <div style={{ ...card(), overflow: "hidden", borderColor: "rgba(251,191,36,0.45)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", color: GOLD }}>NOT SAVED YET</div>
              <div style={{ fontSize: 13, color: HOME_THEME.muted, marginTop: 3 }}>
                {stagedIncluded.length} of {staged.length} selected. Fix anything wrong, then save.
              </div>
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
                  <input
                    type="checkbox" checked={stagedIncluded.length === staged.length}
                    onChange={(e) => setStaged((prev) => prev.map((r) => ({ ...r, include: e.target.checked })))}
                    style={{ accentColor: HOME_THEME.cyan, cursor: "pointer" }}
                  />
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
                <tr key={r.key} style={{ opacity: r.include ? 1 : 0.4, background: r.recurring ? "rgba(251,191,36,0.05)" : undefined }}>
                  <td style={td("center")}>
                    <input type="checkbox" checked={r.include} onChange={(e) => patchStaged(r.key, { include: e.target.checked })} style={{ accentColor: HOME_THEME.cyan, cursor: "pointer" }} />
                  </td>
                  <td style={td("left")}>
                    <input type="date" value={r.date} onChange={(e) => patchStaged(r.key, { date: e.target.value })} style={{ ...field(), padding: "5px 7px", fontSize: 13 }} />
                  </td>
                  <td style={td("left")}>
                    <input value={r.merchant} onChange={(e) => patchStaged(r.key, { merchant: e.target.value })} style={{ ...field(), padding: "5px 8px", fontSize: 13, fontWeight: 700 }} />
                  </td>
                  <td style={{ ...td("left"), color: HOME_THEME.muted, fontSize: 12, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.description}>
                    {r.description}{r.recurring && <span style={{ marginLeft: 6, color: GOLD, fontWeight: 800 }}>🔁</span>}
                  </td>
                  <td style={td("left")}>
                    <ThemedSelect
                      value={r.categoryId == null ? "" : String(r.categoryId)}
                      onChange={(v) => patchStaged(r.key, { categoryId: v ? Number(v) : null })}
                      options={catOptions}
                      placeholder={r.categoryGuess || "— none —"}
                    />
                  </td>
                  <td style={td("right")}>
                    <input type="number" value={r.amount} onChange={(e) => patchStaged(r.key, { amount: Math.abs(Number(e.target.value) || 0) })} style={{ ...field(), padding: "5px 8px", fontSize: 13, textAlign: "right" }} />
                  </td>
                  <td style={td("center")}>
                    <button
                      onClick={() => patchStaged(r.key, { direction: r.direction === "out" ? "in" : "out" })} title="Toggle in / out"
                      style={{ ...ghost(), padding: "5px 10px", fontSize: 12, color: r.direction === "out" ? HOME_THEME.red : GREEN, borderColor: r.direction === "out" ? "rgba(239,68,68,0.4)" : "rgba(52,211,153,0.4)" }}
                    >
                      {r.direction === "out" ? "− out" : "+ in"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Stored month ─────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ ...card(), padding: 20, color: HOME_THEME.muted, fontSize: 14 }}>Loading {month}…</div>
      ) : tx.length === 0 ? (
        <div style={{ ...card(), padding: 28, textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Nothing stored for {month} yet</div>
          <div style={{ fontSize: 13, color: HOME_THEME.muted, marginTop: 6 }}>
            Drop this month's statement above. Use the month picker at the top of the page to look at another month.
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Tile label="Transactions" value={String(tx.length)} sub={month} />
            <Tile label="Money out" value={fmtMoney(totals.outflow, currency)} sub={`${merchants.length} merchants`} valueColor={HOME_THEME.red} />
            <Tile label="Money in" value={fmtMoney(totals.inflow, currency)} valueColor={GREEN} />
            <Tile label="Net" value={fmtMoney(totals.net, currency)} valueColor={totals.net >= 0 ? GREEN : HOME_THEME.red} />
            <Tile label="Subscriptions" value={fmtMoney(totals.subTotal, currency)} sub={`${subRows.length} recurring · ${fmtMoney(totals.subTotal * 12, currency)}/yr`} valueColor={GOLD} />
            <Tile
              label="If you cancel"
              value={fmtMoney(totals.cancelSavings, currency)}
              sub={totals.cancelSavings > 0 ? `${fmtMoney(totals.cancelSavings * 12, currency)}/yr back` : "nothing tagged cancel"}
              valueColor={totals.cancelSavings > 0 ? GREEN : HOME_THEME.muted}
            />
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {(["ledger", "where", "subs"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} style={pill(view === v)}>
                {v === "ledger" ? `Ledger (${tx.length})` : v === "where" ? "Where it went" : `Subscriptions (${subRows.length})`}
              </button>
            ))}
            {totals.uncategorized > 0 && (
              <span style={{ fontSize: 12, color: GOLD, fontWeight: 700, marginLeft: 4 }}>{totals.uncategorized} uncategorized</span>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => void runAdvice()} disabled={advising} style={{ ...ghost(), opacity: advising ? 0.5 : 1, borderColor: "rgba(251,191,36,0.5)", color: GOLD }}>
              {advising ? "Thinking…" : "✦ What to fix"}
            </button>
            <button onClick={() => void clearMonth()} disabled={saving} style={{ ...ghost(), color: HOME_THEME.red, borderColor: "rgba(239,68,68,0.35)" }}>
              Clear {month}
            </button>
          </div>

          {/* Ledger */}
          {view === "ledger" && (
            <div style={{ ...card(), overflow: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: HOME_THEME.muted, fontWeight: 800, letterSpacing: "0.1em" }}>SORT</span>
                {(["date", "merchant", "amount", "category"] as const).map((k) => (
                  <button key={k} onClick={() => toggleSort(k)} style={pill(sortKey === k)}>
                    {k[0].toUpperCase() + k.slice(1)}{sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button onClick={() => setOnlyUncat((v) => !v)} style={{ ...pill(onlyUncat), borderColor: onlyUncat ? "rgba(251,191,36,0.75)" : HAIRLINE, color: onlyUncat ? GOLD : "rgba(255,255,255,0.82)" }}>
                  Only uncategorized ({totals.uncategorized})
                </button>
              </div>
              {sortKey === "merchant" && (
                <div style={{ fontSize: 12, color: HOME_THEME.muted, padding: "0 14px 10px", lineHeight: 1.45 }}>
                  Grouped by vendor — the dropdown on a group's first row re-files <em>every</em> row in that group at once.
                </div>
              )}
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <SortTh label="Date" k="date" width={70} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortTh label="Merchant" k="merchant" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th style={th("left")}>As it read</th>
                    <SortTh label="Category" k="category" align="left" width={200} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortTh label="Amount" k="amount" align="right" width={110} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th style={{ ...th("center"), width: 50 }} />
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((r, i) => {
                    const key = mKey(r.merchant || r.description);
                    const prevKey = i > 0 ? mKey(ledgerRows[i - 1].merchant || ledgerRows[i - 1].description) : null;
                    const grouped = sortKey === "merchant";
                    const firstOfGroup = grouped && key !== prevKey;
                    const groupSize = grouped ? ledgerRows.filter((x) => mKey(x.merchant || x.description) === key).length : 1;
                    return (
                      <tr
                        key={r.id}
                        style={{
                          background: r.is_recurring ? "rgba(251,191,36,0.05)" : undefined,
                          borderTop: firstOfGroup && i > 0 ? `1px solid ${HAIRLINE}` : undefined,
                        }}
                      >
                        <td style={{ ...td("left"), color: HOME_THEME.muted }}>{shortDate(r.tx_date)}</td>
                        <td style={{ ...td("left"), fontWeight: 700, opacity: grouped && !firstOfGroup ? 0.35 : 1 }}>
                          {grouped && !firstOfGroup ? "↳" : r.merchant}
                          {r.is_recurring === 1 && (!grouped || firstOfGroup) && <span style={{ marginLeft: 6, color: GOLD }}>🔁</span>}
                          {firstOfGroup && groupSize > 1 && <span style={{ marginLeft: 7, fontSize: 11, color: HOME_THEME.muted }}>×{groupSize}</span>}
                        </td>
                        <td style={{ ...td("left"), color: HOME_THEME.muted, fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.description}>
                          {r.description}
                        </td>
                        <td style={td("left")}>
                          {/* Sorted by merchant, the first row of a group drives
                              the whole group; the rest stay individually editable. */}
                          {firstOfGroup && groupSize > 1 ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <ThemedSelect
                                value={r.category_id == null ? "" : String(r.category_id)}
                                onChange={(v) => void setMerchantCategory(r.merchant || r.description, v ? Number(v) : null)}
                                options={catOptions}
                              />
                              <span title={`Applies to all ${groupSize} rows`} style={{ fontSize: 10, fontWeight: 900, color: LIGHT_BLUE, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>ALL {groupSize}</span>
                            </div>
                          ) : (
                            <ThemedSelect
                              value={r.category_id == null ? "" : String(r.category_id)}
                              onChange={(v) => void setTxCategory(r.id, v ? Number(v) : null)}
                              options={catOptions}
                            />
                          )}
                        </td>
                        <td style={{ ...td("right"), fontWeight: 800, fontVariantNumeric: "tabular-nums", color: r.direction === "out" ? HOME_THEME.red : GREEN }}>
                          {r.direction === "out" ? "−" : "+"}{fmtMoney(r.amount, currency)}
                        </td>
                        <td style={td("center")}>
                          <button onClick={() => void deleteTx(r.id)} title="Remove from Real Month" style={{ ...ghost(), padding: "4px 9px", fontSize: 13, color: HOME_THEME.muted }}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                  {ledgerRows.length === 0 && (
                    <tr><td colSpan={6} style={{ ...td("center"), color: HOME_THEME.muted, padding: 20 }}>Everything in {month} has a category.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Where it went */}
          {view === "where" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <div style={{ ...card(), overflow: "hidden" }}>
                <SectionHead title="By merchant" sub="Like descriptors merged into one line. Setting a category here re-files every row from that merchant." />
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={th("left")}>Merchant</th><th style={{ ...th("center"), width: 55 }}>×</th><th style={{ ...th("right"), width: 110 }}>Total</th><th style={{ ...th("left"), width: 160 }}>Category</th></tr></thead>
                  <tbody>
                    {merchants.map((m) => {
                      const share = totals.outflow > 0 ? (m.total / totals.outflow) * 100 : 0;
                      return (
                        <tr key={m.merchant}>
                          <td style={{ ...td("left"), fontWeight: 700 }}>
                            <div>{m.merchant}</div>
                            <div style={{ height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)", marginTop: 5, maxWidth: 220 }}>
                              <div style={{ width: `${share}%`, height: 3, borderRadius: 99, background: LIGHT_BLUE }} />
                            </div>
                          </td>
                          <td style={{ ...td("center"), color: HOME_THEME.muted }}>{m.count}</td>
                          <td style={{ ...td("right"), fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(m.total, currency)}</td>
                          {/* Set it here and every row from this merchant moves. */}
                          <td style={td("left")}>
                            <ThemedSelect
                              value={m.categoryId == null ? "" : String(m.categoryId)}
                              onChange={(v) => void setMerchantCategory(m.merchant, v ? Number(v) : null)}
                              options={catOptions}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ ...card(), overflow: "hidden" }}>
                <SectionHead title="By category" sub="Real spend against the budgets on the Categories tab" />
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={th("left")}>Category</th><th style={{ ...th("center"), width: 55 }}>×</th><th style={{ ...th("right"), width: 110 }}>Spent</th><th style={{ ...th("right"), width: 120 }}>vs budget</th></tr></thead>
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
                              <div style={{ height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)", marginTop: 5, maxWidth: 200 }}>
                                <div style={{ width: `${pct}%`, height: 3, borderRadius: 99, background: (delta ?? 0) > 0 ? HOME_THEME.red : GREEN }} />
                              </div>
                            )}
                          </td>
                          <td style={{ ...td("center"), color: HOME_THEME.muted }}>{c.count}</td>
                          <td style={{ ...td("right"), fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(c.spent, currency)}</td>
                          <td style={{ ...td("right"), fontVariantNumeric: "tabular-nums", fontWeight: 700, color: delta == null ? HOME_THEME.muted : delta > 0 ? HOME_THEME.red : GREEN }}>
                            {delta == null ? "—" : `${delta > 0 ? "+" : ""}${fmtMoney(delta, currency)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Subscriptions */}
          {view === "subs" && (
            <div style={{ ...card(), overflow: "hidden" }}>
              <SectionHead
                title="Recurring charges"
                sub="Tag each one. → Payments adds THAT subscription to the register as a monthly recurring rule — the only thing that ever crosses over."
              />
              {subRows.length === 0 ? (
                <div style={{ padding: 20, color: HOME_THEME.muted, fontSize: 14 }}>Nothing in {month} repeats at a steady amount.</div>
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
                          {s.categoryId != null && <span style={{ marginLeft: 8, fontSize: 11, color: HOME_THEME.muted }}>{catById.get(s.categoryId)?.name}</span>}
                        </td>
                        <td style={{ ...td("center"), color: HOME_THEME.muted }}>{s.count}</td>
                        <td style={{ ...td("right"), fontVariantNumeric: "tabular-nums" }}>{fmtMoney(s.each, currency)}</td>
                        <td style={{ ...td("right"), fontWeight: 800, color: GOLD, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(s.monthly * 12, currency)}</td>
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
                            <span style={{ fontSize: 12, color: GREEN, fontWeight: 800 }}>✓ In Payments</span>
                          ) : (
                            <button
                              onClick={() => void pushToPayments(s.merchant, s.each)}
                              title={`Add ${s.merchant} to Payments as a ${fmtMoney(s.each, currency)}/mo recurring rule`}
                              style={{ ...ghost(), padding: "6px 11px", fontSize: 12, color: LIGHT_BLUE, borderColor: "rgba(125,211,252,0.4)" }}
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
            </div>
          )}

          {/* What to fix */}
          {advice && (
            <div style={{ ...card(), padding: 18 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.18em", color: GOLD }}>WHAT TO FIX</div>
                <div style={{ fontSize: 12, color: HOME_THEME.muted }}>{month}</div>
                <div style={{ flex: 1 }} />
                <button onClick={() => void runAdvice()} disabled={advising} style={{ ...ghost(), padding: "6px 12px", fontSize: 12 }}>{advising ? "…" : "Re-run"}</button>
              </div>
              {advice.headline && <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.35, marginTop: 10 }}>{advice.headline}</div>}

              <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                {advice.findings.map((f, i) => {
                  const ui = SEVERITY_UI[f.severity];
                  return (
                    <div key={i} style={{ border: `1px solid ${HAIRLINE}`, borderLeft: `3px solid ${ui.color}`, borderRadius: 10, padding: "12px 14px", background: "rgba(255,255,255,0.02)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: ui.color, border: `1px solid ${ui.color}55`, borderRadius: 999, padding: "2px 8px" }}>{ui.label}</span>
                        <span style={{ fontSize: 15, fontWeight: 800 }}>{f.title}</span>
                        <div style={{ flex: 1 }} />
                        {f.monthlySavings > 0 && (
                          <span style={{ fontSize: 14, fontWeight: 900, color: GREEN, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(f.monthlySavings, currency)}/mo</span>
                        )}
                      </div>
                      <div style={{ fontSize: 14, color: "rgba(255,255,255,0.82)", lineHeight: 1.55, marginTop: 8 }}>{f.detail}</div>
                      {f.evidence && <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{f.evidence}</div>}
                    </div>
                  );
                })}
              </div>

              {advice.quickWins.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={labelCap()}>Quick wins</div>
                  <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
                    {advice.quickWins.map((q, i) => <li key={i} style={{ fontSize: 14, color: "rgba(255,255,255,0.82)", lineHeight: 1.5 }}>{q}</li>)}
                  </ul>
                </div>
              )}
              <div style={{ fontSize: 11, color: HOME_THEME.muted, marginTop: 14, opacity: 0.7 }}>
                Built from the aggregates above — merchant totals, category totals, recurring hits. Individual transactions are never sent.
              </div>
            </div>
          )}
        </>
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
 * first click: the button arms, showing exactly how many rows and what they
 * sum to, and only the second click removes them.
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    <div style={{ ...card(), padding: 0, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "14px 16px", cursor: "pointer", color: HOME_THEME.text }}
      >
        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: HOME_THEME.muted }}>
          {open ? "▾" : "▸"} Undo a Payments import
        </span>
        <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 3 }}>
          Remove rows that were bulk-written into the Payments register — grouped by when they landed.
        </div>
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {err && <div style={{ fontSize: 13, color: HOME_THEME.red, fontWeight: 700, marginBottom: 10 }}>{err}</div>}
          {msg && <div style={{ fontSize: 13, color: GREEN, fontWeight: 700, marginBottom: 10 }}>{msg}</div>}
          {busy && !batches && <div style={{ fontSize: 13, color: HOME_THEME.muted }}>Reading write history…</div>}
          {batches && batches.length === 0 && (
            <div style={{ fontSize: 13, color: HOME_THEME.muted }}>No register rows written in the last 90 days.</div>
          )}
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
                    <tr key={b.bucket} style={{ background: i === 0 && bulk ? "rgba(251,191,36,0.06)" : undefined }}>
                      <td style={{ ...td("left"), fontVariantNumeric: "tabular-nums" }}>
                        {b.bucket.replace("T", " ").slice(0, 16)}
                        {i === 0 && bulk && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 900, color: GOLD, letterSpacing: "0.1em" }}>MOST RECENT</span>}
                      </td>
                      <td style={{ ...td("center"), fontWeight: 800, color: bulk ? GOLD : HOME_THEME.muted }}>{b.n}</td>
                      <td style={{ ...td("right"), fontWeight: 800, fontVariantNumeric: "tabular-nums", color: b.total < 0 ? HOME_THEME.red : GREEN }}>
                        {fmtMoney(b.total, currency)}
                      </td>
                      <td style={{ ...td("left"), fontSize: 12, color: HOME_THEME.muted }}>
                        <div>{b.from_date} → {b.to_date}</div>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300, opacity: 0.8 }}>
                          {b.labels.join(", ")}{b.n > b.labels.length ? " …" : ""}
                        </div>
                      </td>
                      <td style={{ ...td("right") }}>
                        {isArmed ? (
                          <span style={{ display: "inline-flex", gap: 6 }}>
                            <button onClick={() => void remove(b)} disabled={busy} style={{ ...ghost(), padding: "6px 11px", fontSize: 12, color: HOME_THEME.red, borderColor: "rgba(239,68,68,0.6)", background: "rgba(239,68,68,0.12)" }}>
                              {busy ? "…" : `Yes, delete ${b.n}`}
                            </button>
                            <button onClick={() => setArmed(null)} style={{ ...ghost(), padding: "6px 11px", fontSize: 12 }}>Cancel</button>
                          </span>
                        ) : (
                          <button onClick={() => { setArmed(b.bucket); setMsg(null); }} style={{ ...ghost(), padding: "6px 11px", fontSize: 12, color: HOME_THEME.muted }}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 11, color: HOME_THEME.muted, marginTop: 12, opacity: 0.75, lineHeight: 1.5 }}>
            Grouped by the minute each row was written, so one bulk import is one line and a hand-typed row is its own 1-row line.
            Beginning-balance rows are never listed and never deleted. Recurring rules aren't rows, so they're untouched.
          </div>
        </div>
      )}
    </div>
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
      style={{ ...th(align), width, cursor: "pointer", color: active ? LIGHT_BLUE : HOME_THEME.muted, userSelect: "none" }}
    >
      {label}{active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
}

function Tile({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div style={{ ...card(), padding: "12px 14px" }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4, color: valueColor || HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ padding: "14px 16px 10px" }}>
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: LIGHT_BLUE }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
}
