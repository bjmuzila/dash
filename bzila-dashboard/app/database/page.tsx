"use client";

import { useState, useEffect, useCallback } from "react";

const DB_NAME = "OptionsMarketDB";

const STORES = [
  "mvc",
  "premiumFlow",
  "greeksTimeSeries",
  "buySellScores",
  "es15mCandles",
  "greeksHistory",
  "gexTop3",
  "bzilaLiveSnapshots",
] as const;

type Tab = typeof STORES[number];

const TABS: { id: Tab; label: string }[] = [
  { id: "mvc", label: "MVC Snapshots" },
  { id: "premiumFlow", label: "Premium Flow" },
  { id: "greeksTimeSeries", label: "Greeks TS" },
  { id: "buySellScores", label: "Buy/Sell" },
  { id: "es15mCandles", label: "ES Candles" },
  { id: "greeksHistory", label: "Greeks Hist" },
  { id: "gexTop3", label: "GEX Top3" },
  { id: "bzilaLiveSnapshots", label: "Bzila Snaps" },
];

function fmtCell(v: unknown, key?: string): string {
  if (v == null) return "-";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "-";
    if (key === "esPrice" || key === "spxPrice") {
      return v.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
    }
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(3) + "B";
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(3) + "M";
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return Number.isInteger(v) ? v.toString() : v.toFixed(4);
  }
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  const s = String(v);
  if (/^\d{13}$/.test(s)) {
    const d = new Date(Number(s));
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  }
  return s.length > 80 ? s.slice(0, 80) + "..." : s;
}

function fmtStrikeCell(v: unknown): string {
  if (v == null) return "-";
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? v.toLocaleString("en-US")
      : v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  const n = Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(v);
  return Number.isInteger(n)
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toExcelCellValue(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? v : "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") return JSON.stringify(v);

  const s = String(v);
  if (/^\d{13}$/.test(s)) {
    return new Date(Number(s)).toLocaleString("en-US");
  }
  return s;
}

function buildExcelXml(
  sheetName: string,
  columns: string[],
  dataRows: Record<string, unknown>[],
): string {
  const headerRow = columns
    .map((col) => `<Cell ss:StyleID="header"><Data ss:Type="String">${escapeXml(col)}</Data></Cell>`)
    .join("");

  const bodyRows = dataRows
    .map((row) => {
      const cells = columns.map((col) => {
        const value = toExcelCellValue(row[col]);
        if (typeof value === "number") {
          return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
        }
        return `<Cell><Data ss:Type="String">${escapeXml(String(value))}</Data></Cell>`;
      }).join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="header">
   <Font ss:Bold="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${escapeXml(sheetName)}">
  <Table>
   <Row>${headerRow}</Row>
   ${bodyRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onblocked = () => reject(new Error("DB blocked - close other tabs"));
  });
}

async function readStore(
  db: IDBDatabase,
  storeName: string,
  limit: number,
  dateFilter: string,
): Promise<Record<string, unknown>[]> {
  if (!db.objectStoreNames.contains(storeName)) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);

    let req: IDBRequest;
    if (dateFilter && store.indexNames.contains("date")) {
      req = store.index("date").getAll(dateFilter);
    } else {
      req = store.getAll();
    }

    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const all = (req.result as Record<string, unknown>[]) || [];
      const sorted = [...all].sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0));
      resolve(sorted.slice(0, limit));
    };
  });
}

export default function DatabasePage() {
  const [tab, setTab] = useState<Tab>("mvc");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [dateFilter, setDateFilter] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [limit, setLimit] = useState(200);

  const load = useCallback(async (t: Tab, date: string, lim: number) => {
    setLoading(true);
    setError(null);
    try {
      const db = await openDB();
      const data = await readStore(db, t, lim, date);
      db.close();
      setRows(data);
      setCount(data.length);
      if (data.length > 0) {
        const keySet = new Set<string>();
        data.slice(0, 5).forEach((r) => Object.keys(r).forEach((k) => keySet.add(k)));
        setCols([...keySet]);
      } else {
        setCols([]);
      }
    } catch (e) {
      setError(String(e));
      setRows([]);
      setCols([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab, dateFilter, limit);
  }, [tab, dateFilter, limit, load]);

  useEffect(() => {
    const refresh = () => {
      void load(tab, dateFilter, limit);
    };
    window.addEventListener("db-mvc-updated", refresh);
    return () => window.removeEventListener("db-mvc-updated", refresh);
  }, [tab, dateFilter, limit, load]);

  const exportMvcToExcel = useCallback(() => {
    if (tab !== "mvc" || rows.length === 0 || cols.length === 0) return;

    const xml = buildExcelXml("MVC Snapshots", cols, rows);
    const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = dateFilter || "all";
    anchor.href = url;
    anchor.download = `mvc-snapshots-${stamp}.xls`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [tab, rows, cols, dateFilter]);

  function todayET() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
      .toISOString().slice(0, 10);
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg)" }}>
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0 border-b"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
            Database
          </span>
          <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
            {loading ? "Loading..." : `${count} rows`}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-xs" style={{ color: "var(--muted)" }}>Date:</span>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              style={{
                fontSize: 11,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                padding: "2px 6px",
                borderRadius: 3,
                cursor: "pointer",
              }}
            />
            <button
              onClick={() => setDateFilter(todayET())}
              style={{ fontSize: 10, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px" }}
            >
              Today
            </button>
            <button
              onClick={() => setDateFilter("")}
              style={{ fontSize: 10, color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px" }}
            >
              All
            </button>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs" style={{ color: "var(--muted)" }}>Limit:</span>
            {[100, 200, 500].map((n) => (
              <button
                key={n}
                onClick={() => setLimit(n)}
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 2,
                  cursor: "pointer",
                  border: "1px solid",
                  borderColor: limit === n ? "var(--accent)" : "var(--border)",
                  color: limit === n ? "var(--accent)" : "var(--muted)",
                  background: "transparent",
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportMvcToExcel}
            disabled={tab !== "mvc" || rows.length === 0}
            className="text-xs px-3 py-1 rounded border"
            style={{
              borderColor: "var(--border)",
              color: tab === "mvc" && rows.length > 0 ? "var(--accent)" : "var(--muted)",
              background: "transparent",
              cursor: tab === "mvc" && rows.length > 0 ? "pointer" : "not-allowed",
              opacity: tab === "mvc" && rows.length > 0 ? 1 : 0.5,
            }}
          >
            Export Excel
          </button>
          <button
            onClick={() => void load(tab, dateFilter, limit)}
            className="text-xs px-3 py-1 rounded border"
            style={{ borderColor: "var(--border)", color: "var(--accent)", background: "transparent", cursor: "pointer" }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div
        className="flex flex-shrink-0 border-b overflow-x-auto"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 14px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              background: "transparent",
              border: "none",
              borderBottom: "2px solid",
              borderBottomColor: tab === t.id ? "var(--accent)" : "transparent",
              color: tab === t.id ? "var(--accent)" : "var(--muted)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-xs" style={{ color: "var(--red)" }}>
            <div>Warning: {error}</div>
            <div style={{ color: "var(--muted)", textAlign: "center", maxWidth: 400 }}>
              Make sure the vanilla dashboard has been opened at least once to initialize the IndexedDB.
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-40 text-xs" style={{ color: "var(--muted)" }}>
            Loading...
          </div>
        ) : cols.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-1 text-xs" style={{ color: "var(--muted)" }}>
            <div>No data in <strong>{tab}</strong></div>
            {dateFilter && <div style={{ fontSize: 10 }}>Try clearing the date filter (All) to see all records</div>}
          </div>
        ) : (
          <table style={{ width: "100%", fontSize: 11, fontFamily: "monospace", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface)", position: "sticky", top: 0, zIndex: 1 }}>
                {cols.map((c) => (
                  <th
                    key={c}
                    style={{
                      padding: "5px 10px",
                      textAlign: "left",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--muted)",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      fontSize: 9,
                    }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)",
                  }}
                >
                  {cols.map((c) => {
                    const v = row[c];
                    const isStrikeCol = c.toLowerCase().includes("strike");
                    const n = typeof v === "number";
                    const neg = n && v < 0;
                    const pos = n && v > 0;
                    return (
                      <td
                        key={c}
                        style={{
                          padding: "4px 10px",
                          whiteSpace: "nowrap",
                          color: neg ? "var(--red)" : pos ? "#e8edf5" : "var(--muted)",
                          textAlign: n ? "right" : "left",
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {isStrikeCol ? fmtStrikeCell(v) : fmtCell(v, c)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
