"use client";

// TODO: wire up real GEX data via useSWR → /api/gex
export default function GexTable() {
  return (
    <div className="rounded border p-4 text-xs" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--accent)" }}>GEX Table</h2>
      <p style={{ color: "var(--muted)" }}>Loading GEX data…</p>
    </div>
  );
}
