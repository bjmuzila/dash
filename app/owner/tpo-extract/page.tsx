// TPO Level Extractor — paste a Market-Profile chart screenshot, Claude vision
// reads the H/L/POC/VAH/VAL/Mid off each session, renders an editable table you
// can fix and export to CSV / Excel. Owner-only via the /owner/* middleware gate.
"use client";

import { useCallback, useRef, useState } from "react";
import { HOME_THEME, homeButtonStyle, homeInputStyle, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

interface TpoRow {
  date: string | null;
  high: number | null;
  low: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  mid: number | null;
  note: string | null;
}

type ColKey = "date" | "high" | "low" | "poc" | "vah" | "val" | "mid" | "note";
const COLS: { key: ColKey; label: string; num: boolean }[] = [
  { key: "date", label: "Date", num: false },
  { key: "high", label: "High", num: true },
  { key: "low", label: "Low", num: true },
  { key: "poc", label: "POC", num: true },
  { key: "vah", label: "VAH", num: true },
  { key: "val", label: "VAL", num: true },
  { key: "mid", label: "Mid", num: true },
  { key: "note", label: "Note", num: false },
];

const fmt = (v: number | null): string => (v == null ? "" : String(v));
const rangeOf = (r: TpoRow): string =>
  r.high != null && r.low != null ? (r.high - r.low).toFixed(2) : "";

export default function TpoExtractPage() {
  const [rows, setRows] = useState<TpoRow[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [symbol, setSymbol] = useState("ES (ESU)");
  const [year, setYear] = useState("2026");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImage = useCallback((dataUrl: string) => {
    setPreview(dataUrl);
    setStatus("");
  }, []);

  const readFile = useCallback((file: File | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const rd = new FileReader();
    rd.onload = (e) => handleImage(String(e.target?.result || ""));
    rd.readAsDataURL(file);
  }, [handleImage]);

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (item) { readFile(item.getAsFile()); e.preventDefault(); }
  }, [readFile]);

  const extract = useCallback(async () => {
    if (!preview) { setStatus("Paste or drop a chart screenshot first."); return; }
    setBusy(true);
    setStatus("Reading levels…");
    try {
      const res = await fetch("/api/tpo-extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: preview, symbol, year: Number(year) || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !Array.isArray(json.rows)) {
        throw new Error(json.error || `request failed (${res.status})`);
      }
      setRows((prev) => [...prev, ...(json.rows as TpoRow[])]);
      setStatus(`Added ${json.rows.length} session${json.rows.length === 1 ? "" : "s"}. Check the values, then export.`);
      setPreview(null);
    } catch (err) {
      setStatus(`Extract failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setBusy(false);
    }
  }, [preview, symbol, year]);

  const editCell = (i: number, key: ColKey, raw: string) => {
    setRows((prev) => {
      const next = [...prev];
      const row = { ...next[i] };
      if (key === "date" || key === "note") {
        (row[key] as string | null) = raw.trim() || null;
      } else {
        const n = Number(raw.replace(/[, ]/g, ""));
        (row[key] as number | null) = raw.trim() === "" ? null : Number.isFinite(n) ? n : null;
      }
      next[i] = row;
      return next;
    });
  };

  const delRow = (i: number) => setRows((prev) => prev.filter((_, k) => k !== i));
  const clearAll = () => { setRows([]); setPreview(null); setStatus(""); };

  const EXPORT_HEAD = ["Date", "High", "Low", "POC", "VAH", "VAL", "Range", "Mid", "Note"];
  const exportMatrix = (): string[][] =>
    rows.map((r) => [
      r.date ?? "", fmt(r.high), fmt(r.low), fmt(r.poc), fmt(r.vah), fmt(r.val),
      rangeOf(r), fmt(r.mid), r.note ?? "",
    ]);

  const copyTsv = async () => {
    const tsv = [EXPORT_HEAD, ...exportMatrix()].map((r) => r.join("\t")).join("\n");
    try { await navigator.clipboard.writeText(tsv); setStatus("Copied — paste straight into Excel / Sheets."); }
    catch { setStatus("Clipboard blocked — use Download CSV instead."); }
  };

  const downloadCsv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [EXPORT_HEAD, ...exportMatrix()].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "tpo-levels.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const th: React.CSSProperties = {
    fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
    color: "#7f92a8", padding: "8px 8px", textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.12)",
    whiteSpace: "nowrap", position: "sticky", top: 0, background: "rgba(10,13,20,0.98)",
  };
  const cellInput: React.CSSProperties = {
    width: "100%", background: "transparent", border: "none", outline: "none",
    color: HOME_THEME.text, fontFamily: "var(--font-mono, monospace)", fontSize: 13,
    textAlign: "right", padding: "5px 6px",
  };

  return (
    <PageShell>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="TPO Level Extractor"
        subtitle="Paste a Market-Profile screenshot — Claude reads the H / L / POC / VAH / VAL / Mid off every session."
      >
        <div
          onPaste={onPaste}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); readFile(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          style={{
            border: "1.5px dashed rgba(255,255,255,0.22)", borderRadius: 12, padding: 22,
            textAlign: "center", color: "#9aa4b2", cursor: "pointer", background: "rgba(255,255,255,0.02)",
          }}
        >
          {preview
            ? <img src={preview} alt="pasted chart" style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 8 }} />
            : <span style={{ fontSize: 14 }}>Click to choose, <b>drop</b>, or <b>paste (Ctrl/Cmd+V)</b> a chart screenshot here.</span>}
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={(e) => readFile(e.target.files?.[0])} />
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <label style={{ fontSize: 13, color: HOME_THEME.text, display: "flex", gap: 6, alignItems: "center" }}>
            Instrument
            <input style={{ ...homeInputStyle, width: 120 }} value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          </label>
          <label style={{ fontSize: 13, color: HOME_THEME.text, display: "flex", gap: 6, alignItems: "center" }}>
            Year
            <input style={{ ...homeInputStyle, width: 80 }} value={year} onChange={(e) => setYear(e.target.value)} />
          </label>
          <button style={{ ...homeButtonStyle, padding: "8px 18px" }} onClick={extract} disabled={busy || !preview}>
            {busy ? "Reading…" : "Extract levels"}
          </button>
          {status && <span style={{ fontSize: 12, color: "#8ECAE6" }}>{status}</span>}
        </div>
      </Card>

      {rows.length > 0 && (
        <Card variant="budget" accent={LIGHT_BLUE} title={`Levels — ${rows.length} session${rows.length === 1 ? "" : "s"}`} subtitle="Every cell is editable — fix any misread before exporting. Range is High − Low.">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <button style={{ ...homeButtonStyle, padding: "7px 14px" }} onClick={copyTsv}>Copy for Excel</button>
            <button style={{ ...homeButtonStyle, padding: "7px 14px" }} onClick={downloadCsv}>Download CSV</button>
            <button style={{ ...homeButtonStyle, padding: "7px 14px", opacity: 0.8 }} onClick={clearAll}>Clear</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr>
                  {COLS.map((c) => <th key={c.key} style={{ ...th, textAlign: c.num ? "right" : "left" }}>{c.label}</th>)}
                  <th style={th}>Range</th>
                  <th style={{ ...th, textAlign: "center" }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    {COLS.map((c) => (
                      <td key={c.key} style={{ padding: 0 }}>
                        <input
                          style={{ ...cellInput, textAlign: c.num ? "right" : "left", color: c.key === "poc" ? "#FB8501" : HOME_THEME.text }}
                          value={c.key === "date" || c.key === "note" ? (r[c.key] ?? "") : fmt(r[c.key] as number | null)}
                          onChange={(e) => editCell(i, c.key, e.target.value)}
                        />
                      </td>
                    ))}
                    <td style={{ ...cellInput, color: "#9aa4b2", textAlign: "right", paddingRight: 8 }}>{rangeOf(r)}</td>
                    <td style={{ textAlign: "center" }}>
                      <button onClick={() => delRow(i)} title="remove row"
                        style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.4)", color: "#ef6b6b", borderRadius: 4, cursor: "pointer", fontSize: 11, padding: "2px 7px" }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageShell>
  );
}
