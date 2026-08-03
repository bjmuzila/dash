import { useMemo, useRef, useState } from "react";
import { HOME_THEME } from "../../lib/theme";
import { ThemedSelect } from "../../components/ThemedSelect";

/**
 * Budget → Import tab.
 *
 * Drop a statement PDF or a screenshot of a transaction list, Claude extracts
 * the rows (POST /api/budget/parse-statement), and everything lands in a
 * STAGING table — nothing touches budget_register until you press Commit. From
 * the staged rows the tab derives three reads:
 *
 *   • Merchants — noisy descriptors normalized to a brand, rolled into one line
 *     with total + count, so "AMZN MKTP US*2K4" and "AMZN Mktp US*9RT" merge.
 *   • Categories — Claude files each row against your existing
 *     budget_categories; you can override any of them inline.
 *   • Subscriptions — merchants that repeat at a near-identical amount.
 *
 * "What to fix" (POST /api/budget/advise) sends only those aggregates — never
 * the raw transaction list — and returns ranked findings with dollar figures.
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

/** One parsed transaction, staged for review. `key` is client-side only. */
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
  bank: Bank;
  include: boolean;
};

type Finding = { title: string; severity: "high" | "medium" | "low"; detail: string; monthlySavings: number; evidence: string };
type Advice = { headline: string; findings: Finding[]; quickWins: string[] };

type View = "review" | "merchants" | "subs";

const BANKS: Bank[] = ["coastal", "truist", "secu"];
const BANK_LABEL: Record<Bank, string> = { coastal: "COASTAL", truist: "TRUIST", secu: "SECU" };

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount || 0);
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

const SEVERITY_UI: Record<Finding["severity"], { color: string; label: string }> = {
  high: { color: HOME_THEME.red, label: "HIGH" },
  medium: { color: GOLD, label: "MEDIUM" },
  low: { color: LIGHT_BLUE, label: "LOW" },
};

export default function StatementImport({
  categories,
  currency,
  defaultBank = "secu",
  onCommitted,
  onOpenCategories,
}: {
  categories: Category[];
  currency: string;
  defaultBank?: Bank;
  /** Called after a successful bulk insert so the parent can refetch the month. */
  onCommitted: () => void | Promise<void>;
  onOpenCategories?: () => void;
}) {
  const [rows, setRows] = useState<StagedRow[]>([]);
  const [view, setView] = useState<View>("review");
  const [bank, setBank] = useState<Bank>(defaultBank);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [advising, setAdvising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const included = useMemo(() => rows.filter((r) => r.include), [rows]);

  // ── parse ────────────────────────────────────────────────────────────────
  const handleFiles = async (files: FileList | File[] | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setError(null);
    setNotice(null);
    setParsing(true);
    try {
      let added = 0;
      for (const file of list) {
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        const isImg = file.type.startsWith("image/");
        if (!isPdf && !isImg) { setError(`${file.name} isn't a PDF or an image — skipped.`); continue; }
        if (file.size > 25 * 1024 * 1024) { setError(`${file.name} is over 25 MB — split it and try again.`); continue; }

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
        if (!res.ok) { setError(json?.error || `Parse failed (${res.status}).`); continue; }

        const parsed: StagedRow[] = (json.rows || []).map((r: Record<string, unknown>, i: number) => ({
          key: `${file.name}-${Date.now()}-${i}`,
          date: String(r.date ?? ""),
          description: String(r.description ?? ""),
          merchant: String(r.merchant ?? r.description ?? ""),
          amount: Number(r.amount ?? 0),
          direction: r.direction === "in" ? "in" : "out",
          categoryId: r.categoryId == null ? null : Number(r.categoryId),
          categoryGuess: String(r.categoryGuess ?? ""),
          recurring: r.recurring === true,
          bank,
          include: true,
        }));
        added += parsed.length;
        setRows((prev) => [...prev, ...parsed].sort((a, b) => a.date.localeCompare(b.date)));
        setSourceName(file.name);
      }
      if (added) setNotice(`Parsed ${added} transaction${added === 1 ? "" : "s"}. Review, then commit.`);
      else if (!error) setError("No transactions could be read from that file.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed.");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const patch = (key: string, next: Partial<StagedRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

  // ── derived: merchant rollup ─────────────────────────────────────────────
  const merchants = useMemo(() => {
    const map = new Map<string, { merchant: string; total: number; count: number; categoryId: number | null; amounts: number[]; dates: string[] }>();
    for (const r of included) {
      if (r.direction !== "out") continue;
      const k = r.merchant.trim().toLowerCase() || r.description.trim().toLowerCase();
      const hit = map.get(k);
      if (hit) {
        hit.total += r.amount;
        hit.count += 1;
        hit.amounts.push(r.amount);
        hit.dates.push(r.date);
        if (hit.categoryId == null) hit.categoryId = r.categoryId;
      } else {
        map.set(k, { merchant: r.merchant || r.description, total: r.amount, count: 1, categoryId: r.categoryId, amounts: [r.amount], dates: [r.date] });
      }
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [included]);

  // ── derived: category rollup vs budget ───────────────────────────────────
  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; id: number | null; spent: number; count: number; budget: number }>();
    for (const r of included) {
      if (r.direction !== "out") continue;
      const cat = r.categoryId != null ? catById.get(r.categoryId) : undefined;
      const name = cat?.name || r.categoryGuess || "Uncategorized";
      const k = name.toLowerCase();
      const hit = map.get(k);
      if (hit) { hit.spent += r.amount; hit.count += 1; }
      else map.set(k, { name, id: cat?.id ?? null, spent: r.amount, count: 1, budget: cat?.amount ?? 0 });
    }
    return [...map.values()].sort((a, b) => b.spent - a.spent);
  }, [included, catById]);

  // ── derived: subscriptions ───────────────────────────────────────────────
  // A merchant counts as a subscription when Claude flagged it recurring, OR it
  // appears 2+ times at a near-identical amount (within 5% of the median).
  const subscriptions = useMemo(() => {
    const flagged = new Set(included.filter((r) => r.recurring).map((r) => (r.merchant || r.description).trim().toLowerCase()));
    return merchants
      .map((m) => {
        const sorted = [...m.amounts].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] || 0;
        const tight = median > 0 && m.amounts.every((a) => Math.abs(a - median) <= median * 0.05);
        const repeats = m.count >= 2 && tight;
        const isSub = repeats || flagged.has(m.merchant.trim().toLowerCase());
        return { ...m, median, repeats, isSub, monthly: repeats ? median : m.total };
      })
      .filter((m) => m.isSub)
      .sort((a, b) => b.monthly - a.monthly);
  }, [merchants, included]);

  const totals = useMemo(() => {
    const outflow = included.filter((r) => r.direction === "out").reduce((s, r) => s + r.amount, 0);
    const inflow = included.filter((r) => r.direction === "in").reduce((s, r) => s + r.amount, 0);
    const uncategorized = included.filter((r) => r.direction === "out" && r.categoryId == null).length;
    const subTotal = subscriptions.reduce((s, m) => s + m.monthly, 0);
    return { outflow, inflow, net: inflow - outflow, uncategorized, subTotal };
  }, [included, subscriptions]);

  const period = useMemo(() => {
    if (!included.length) return "";
    const dates = included.map((r) => r.date).sort();
    return dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} → ${dates[dates.length - 1]}`;
  }, [included]);

  // ── commit ───────────────────────────────────────────────────────────────
  // Two passes: registerRowsBulk inserts the rows (signed — outflow negative to
  // match the register's convention), then a GET re-read matches the freshly
  // inserted rows back by date+label+amount so each one can be tagged with its
  // category. The bulk endpoint has no category field, so this is the join.
  const commit = async () => {
    if (!included.length) return;
    setCommitting(true);
    setError(null);
    setNotice(null);
    try {
      const payload = included.map((r) => ({
        date: r.date,
        label: (r.merchant || r.description).toUpperCase().slice(0, 60),
        bank: r.bank,
        amount: r.direction === "out" ? -Math.abs(r.amount) : Math.abs(r.amount),
      }));
      const res = await fetch("/api/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "registerRowsBulk", rows: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) { setError(json?.error || "Commit failed."); setCommitting(false); return; }

      // Tag categories on the rows that just landed.
      const months = [...new Set(included.map((r) => r.date.slice(0, 7)))];
      const tagged = new Set<number>();
      for (const m of months) {
        const look = await fetch(`/api/budget?month=${m}`, { cache: "no-store" });
        if (!look.ok) continue;
        const data = await look.json();
        const registerRows: { id: number; entry_date: string; label: string; amount: number }[] = data.register || [];
        for (const staged of included) {
          if (staged.categoryId == null || staged.date.slice(0, 7) !== m) continue;
          const label = (staged.merchant || staged.description).toUpperCase().slice(0, 60);
          const signed = staged.direction === "out" ? -Math.abs(staged.amount) : Math.abs(staged.amount);
          const match = registerRows.find(
            (rr) => !tagged.has(rr.id) && rr.entry_date.slice(0, 10) === staged.date && rr.label === label && Math.abs(Number(rr.amount) - signed) < 0.005
          );
          if (!match) continue;
          tagged.add(match.id);
          await fetch("/api/budget", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "assignCategory", id: match.id, categoryId: staged.categoryId }),
          });
        }
      }

      setNotice(`Committed ${json.inserted ?? included.length} rows to Payments${tagged.size ? `, ${tagged.size} categorized` : ""}.`);
      setRows((prev) => prev.filter((r) => !r.include));
      await onCommitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commit failed.");
    } finally {
      setCommitting(false);
    }
  };

  // ── what to fix ──────────────────────────────────────────────────────────
  const runAdvice = async () => {
    if (!included.length) return;
    setAdvising(true);
    setError(null);
    try {
      const res = await fetch("/api/budget/advise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period,
          currency,
          totals: { inflow: totals.inflow, outflow: totals.outflow, net: totals.net, transactions: included.length },
          categories: byCategory.map((c) => ({ name: c.name, spent: Number(c.spent.toFixed(2)), budget: c.budget, count: c.count })),
          merchants: merchants.slice(0, 40).map((m) => ({ merchant: m.merchant, total: Number(m.total.toFixed(2)), count: m.count })),
          subscriptions: subscriptions.map((s) => ({ merchant: s.merchant, monthly: Number(s.monthly.toFixed(2)), count: s.count })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error || `Advice failed (${res.status}).`); setAdvising(false); return; }
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── Dropzone ─────────────────────────────────────────────────────── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(e.dataTransfer.files); }}
        style={{
          ...card(),
          padding: 20,
          borderStyle: "dashed",
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
              Claude extracts every transaction, cleans up the merchant name, and files it against your categories.
              Nothing is written to Payments until you press Commit.
              {sourceName && !parsing ? <> Last read: <span style={{ color: LIGHT_BLUE }}>{sourceName}</span>.</> : null}
            </div>
          </div>
          <div style={{ width: 150 }}>
            <div style={labelCap()}>Bank</div>
            <ThemedSelect
              value={bank}
              onChange={(v) => { setBank(v as Bank); setRows((prev) => prev.map((r) => ({ ...r, bank: v as Bank }))); }}
              options={BANKS.map((b) => ({ value: b, label: BANK_LABEL[b] }))}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", paddingBottom: 1 }}>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              multiple
              onChange={(e) => void handleFiles(e.target.files)}
              style={{ display: "none" }}
            />
            <button onClick={() => fileRef.current?.click()} disabled={parsing} style={{ ...primary(), opacity: parsing ? 0.5 : 1 }}>
              {parsing ? "Parsing…" : "Choose file"}
            </button>
            {rows.length > 0 && (
              <button onClick={() => { setRows([]); setAdvice(null); setNotice(null); setError(null); }} style={ghost()}>Clear</button>
            )}
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

      {rows.length > 0 && (
        <>
          {/* ── Stat strip ─────────────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Tile label="Staged" value={String(included.length)} sub={period || "—"} />
            <Tile label="Money out" value={fmtMoney(totals.outflow, currency)} sub={`${merchants.length} merchants`} valueColor={HOME_THEME.red} />
            <Tile label="Money in" value={fmtMoney(totals.inflow, currency)} valueColor={GREEN} />
            <Tile label="Net" value={fmtMoney(totals.net, currency)} valueColor={totals.net >= 0 ? GREEN : HOME_THEME.red} />
            <Tile label="Recurring" value={fmtMoney(totals.subTotal, currency)} sub={`${subscriptions.length} subscriptions`} valueColor={GOLD} />
            <Tile label="Uncategorized" value={String(totals.uncategorized)} sub={totals.uncategorized ? "needs a category" : "all filed"} valueColor={totals.uncategorized ? GOLD : GREEN} />
          </div>

          {/* ── View switch + actions ─────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {(["review", "merchants", "subs"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} style={pill(view === v)}>
                {v === "review" ? `Review (${rows.length})` : v === "merchants" ? `Merged (${merchants.length})` : `Subscriptions (${subscriptions.length})`}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button onClick={() => void runAdvice()} disabled={advising || !included.length} style={{ ...ghost(), opacity: advising || !included.length ? 0.5 : 1, borderColor: "rgba(251,191,36,0.5)", color: GOLD }}>
              {advising ? "Thinking…" : "✦ What to fix"}
            </button>
            <button onClick={() => void commit()} disabled={committing || !included.length} style={{ ...primary(), opacity: committing || !included.length ? 0.5 : 1 }}>
              {committing ? "Committing…" : `Commit ${included.length} → Payments`}
            </button>
          </div>

          {/* ── Review table ──────────────────────────────────────────────── */}
          {view === "review" && (
            <div style={{ ...card(), overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th("center"), width: 44 }}>
                      <input
                        type="checkbox"
                        checked={included.length === rows.length && rows.length > 0}
                        onChange={(e) => setRows((prev) => prev.map((r) => ({ ...r, include: e.target.checked })))}
                        style={{ accentColor: HOME_THEME.cyan, cursor: "pointer" }}
                      />
                    </th>
                    <th style={{ ...th("left"), width: 90 }}>Date</th>
                    <th style={th("left")}>Merchant</th>
                    <th style={th("left")}>As it read</th>
                    <th style={{ ...th("left"), width: 170 }}>Category</th>
                    <th style={{ ...th("right"), width: 120 }}>Amount</th>
                    <th style={{ ...th("center"), width: 70 }}>Dir</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={{ opacity: r.include ? 1 : 0.4, background: r.recurring ? "rgba(251,191,36,0.05)" : undefined }}>
                      <td style={td("center")}>
                        <input type="checkbox" checked={r.include} onChange={(e) => patch(r.key, { include: e.target.checked })} style={{ accentColor: HOME_THEME.cyan, cursor: "pointer" }} />
                      </td>
                      <td style={td("left")}>
                        <input type="date" value={r.date} onChange={(e) => patch(r.key, { date: e.target.value })} style={{ ...field(), padding: "5px 7px", fontSize: 13 }} />
                      </td>
                      <td style={td("left")}>
                        <input value={r.merchant} onChange={(e) => patch(r.key, { merchant: e.target.value })} style={{ ...field(), padding: "5px 8px", fontSize: 13, fontWeight: 700 }} />
                      </td>
                      <td style={{ ...td("left"), color: HOME_THEME.muted, fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.description}>
                        {r.description}
                        {r.recurring && <span style={{ marginLeft: 6, color: GOLD, fontWeight: 800 }}>🔁</span>}
                      </td>
                      <td style={td("left")}>
                        <ThemedSelect
                          value={r.categoryId == null ? "" : String(r.categoryId)}
                          onChange={(v) => patch(r.key, { categoryId: v ? Number(v) : null })}
                          options={catOptions}
                          placeholder={r.categoryGuess || "— none —"}
                        />
                      </td>
                      <td style={td("right")}>
                        <input
                          type="number"
                          value={r.amount}
                          onChange={(e) => patch(r.key, { amount: Math.abs(Number(e.target.value) || 0) })}
                          style={{ ...field(), padding: "5px 8px", fontSize: 13, textAlign: "right" }}
                        />
                      </td>
                      <td style={td("center")}>
                        <button
                          onClick={() => patch(r.key, { direction: r.direction === "out" ? "in" : "out" })}
                          title="Toggle in / out"
                          style={{
                            ...ghost(), padding: "5px 10px", fontSize: 12,
                            color: r.direction === "out" ? HOME_THEME.red : GREEN,
                            borderColor: r.direction === "out" ? "rgba(239,68,68,0.4)" : "rgba(52,211,153,0.4)",
                          }}
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

          {/* ── Merged by merchant + by category ──────────────────────────── */}
          {view === "merchants" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <div style={{ ...card(), overflow: "hidden" }}>
                <SectionHead title="By merchant" sub="Like descriptors rolled into one line" />
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={th("left")}>Merchant</th><th style={{ ...th("center"), width: 60 }}>×</th><th style={{ ...th("right"), width: 110 }}>Total</th><th style={{ ...th("right"), width: 100 }}>Avg</th></tr></thead>
                  <tbody>
                    {merchants.map((m) => (
                      <tr key={m.merchant}>
                        <td style={{ ...td("left"), fontWeight: 700 }}>
                          {m.merchant}
                          {m.categoryId != null && <span style={{ marginLeft: 8, fontSize: 11, color: HOME_THEME.muted, letterSpacing: "0.06em" }}>{catById.get(m.categoryId)?.name}</span>}
                        </td>
                        <td style={{ ...td("center"), color: HOME_THEME.muted }}>{m.count}</td>
                        <td style={{ ...td("right"), fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(m.total, currency)}</td>
                        <td style={{ ...td("right"), color: HOME_THEME.muted, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(m.total / m.count, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ ...card(), overflow: "hidden" }}>
                <SectionHead title="By category" sub="Against the budget you set on Categories" />
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={th("left")}>Category</th><th style={{ ...th("center"), width: 60 }}>×</th><th style={{ ...th("right"), width: 110 }}>Spent</th><th style={{ ...th("right"), width: 120 }}>vs budget</th></tr></thead>
                  <tbody>
                    {byCategory.map((c) => {
                      const delta = c.budget > 0 ? c.spent - c.budget : null;
                      return (
                        <tr key={c.name}>
                          <td style={{ ...td("left"), fontWeight: 700 }}>{c.name}</td>
                          <td style={{ ...td("center"), color: HOME_THEME.muted }}>{c.count}</td>
                          <td style={{ ...td("right"), fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(c.spent, currency)}</td>
                          <td style={{ ...td("right"), fontVariantNumeric: "tabular-nums", color: delta == null ? HOME_THEME.muted : delta > 0 ? HOME_THEME.red : GREEN, fontWeight: 700 }}>
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

          {/* ── Subscriptions ─────────────────────────────────────────────── */}
          {view === "subs" && (
            <div style={{ ...card(), overflow: "hidden" }}>
              <SectionHead title="Looks recurring" sub="Repeats at a near-identical amount, or flagged as a subscription" />
              {subscriptions.length === 0 ? (
                <div style={{ padding: 20, color: HOME_THEME.muted, fontSize: 14 }}>Nothing in this batch repeats at a steady amount.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={th("left")}>Merchant</th><th style={{ ...th("center"), width: 70 }}>Hits</th><th style={{ ...th("right"), width: 120 }}>Each</th><th style={{ ...th("right"), width: 120 }}>In batch</th><th style={{ ...th("right"), width: 130 }}>Per year</th></tr></thead>
                  <tbody>
                    {subscriptions.map((s) => (
                      <tr key={s.merchant}>
                        <td style={{ ...td("left"), fontWeight: 700 }}>🔁 {s.merchant}</td>
                        <td style={{ ...td("center"), color: HOME_THEME.muted }}>{s.count}</td>
                        <td style={{ ...td("right"), fontVariantNumeric: "tabular-nums" }}>{fmtMoney(s.median, currency)}</td>
                        <td style={{ ...td("right"), fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(s.total, currency)}</td>
                        <td style={{ ...td("right"), color: GOLD, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(s.monthly * 12, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── What to fix ───────────────────────────────────────────────── */}
          {advice && (
            <div style={{ ...card(), padding: 18 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.18em", color: GOLD }}>WHAT TO FIX</div>
                <div style={{ fontSize: 12, color: HOME_THEME.muted }}>{period}</div>
                <div style={{ flex: 1 }} />
                <button onClick={() => void runAdvice()} disabled={advising} style={{ ...ghost(), padding: "6px 12px", fontSize: 12 }}>
                  {advising ? "…" : "Re-run"}
                </button>
              </div>
              {advice.headline && (
                <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.35, marginTop: 10 }}>{advice.headline}</div>
              )}

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
                          <span style={{ fontSize: 14, fontWeight: 900, color: GREEN, fontVariantNumeric: "tabular-nums" }}>
                            {fmtMoney(f.monthlySavings, currency)}/mo
                          </span>
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
                    {advice.quickWins.map((q, i) => (
                      <li key={i} style={{ fontSize: 14, color: "rgba(255,255,255,0.82)", lineHeight: 1.5 }}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div style={{ fontSize: 11, color: HOME_THEME.muted, marginTop: 14, opacity: 0.7 }}>
                Generated from the aggregates above — merchant totals, category totals, and recurring hits. Individual transactions are never sent.
              </div>
            </div>
          )}
        </>
      )}
    </div>
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
      {sub && <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
