import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  OWNER_THEME,
  classicCardStyle,
  homeButtonStyle,
  homeContentStyle,
  homeInputStyle,
  homeSecondaryButtonStyle,
  homeShellStyle,
  ownerRgba,
} from "../lib/theme";

/**
 * LSE Data — London Strategic Edge vault browser.
 *
 * The Node port of the interactive futures_data_downloader.py CLI: its menu is
 * the tab strip, its input() prompts are the fields, and save_to_csv() is the
 * Download CSV button (which hits the same endpoint with format=csv and lets
 * the browser stream the file straight to disk — the big pulls never land in
 * this tab's memory).
 *
 * Every request goes to /api/lse/* on this origin, which is owner-gated in
 * server-v2/api-router.js and holds the API key server-side. The key is never
 * shipped to the client.
 */

type Row = Record<string, unknown>;
type TabId = "catalog" | "candles" | "chain" | "flow" | "contract";

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: "catalog", label: "Catalog", hint: "every symbol the vault holds, with its history span" },
  { id: "candles", label: "Candles", hint: "OHLCV for futures, stocks, FX, crypto, indices" },
  { id: "chain", label: "Options Chain", hint: "current chain with IV, greeks and today's volume" },
  { id: "flow", label: "Options Flow", hint: "the print tape — trailing week" },
  { id: "contract", label: "Contract Candles", hint: "1m premium bars for one option contract" },
];

const PREVIEW_ROWS = 300;

// ── shared bits of chrome ────────────────────────────────────────────────────

const cardStyle: CSSProperties = { ...classicCardStyle, padding: 18 };

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: ownerRgba(OWNER_THEME.text, 0.55),
  marginBottom: 6,
  display: "block",
};

const fieldRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 14,
  alignItems: "flex-end",
};

function Field({
  label,
  hint,
  width = 160,
  children,
}: {
  label: string;
  hint?: string;
  width?: number;
  children: ReactNode;
}) {
  return (
    <div style={{ minWidth: width, flex: `0 1 ${width}px` }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint ? (
        <div style={{ fontSize: 11, color: ownerRgba(OWNER_THEME.text, 0.4), marginTop: 4 }}>{hint}</div>
      ) : null}
    </div>
  );
}

const inputStyle: CSSProperties = { ...homeInputStyle, width: "100%", boxSizing: "border-box" };

/** Cells: numbers get thousands separators, ISO stamps get trimmed, rest clipped. */
function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    return Number.isInteger(v)
      ? v.toLocaleString("en-US")
      : v.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return s.replace("T", " ").replace(/(\.\d+)?Z?$/, "");
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

function DataTable({ rows }: { rows: Row[] }) {
  const cols = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows.slice(0, 50)) {
      for (const k of Object.keys(r)) {
        if (!seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
    }
    return out;
  }, [rows]);

  if (!rows.length) return null;

  return (
    <div style={{ overflow: "auto", maxHeight: "52vh", borderRadius: 12, border: `1px solid ${OWNER_THEME.border}` }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  background: OWNER_THEME.panelBgStrong,
                  textAlign: "left",
                  padding: "9px 12px",
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: ownerRgba(OWNER_THEME.text, 0.6),
                  borderBottom: `1px solid ${OWNER_THEME.border}`,
                  whiteSpace: "nowrap",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
            <tr key={i} style={{ background: i % 2 ? ownerRgba(OWNER_THEME.text, 0.02) : "transparent" }}>
              {cols.map((c) => (
                <td
                  key={c}
                  style={{
                    padding: "7px 12px",
                    borderBottom: `1px solid ${ownerRgba(OWNER_THEME.text, 0.05)}`,
                    whiteSpace: "nowrap",
                    color: OWNER_THEME.text,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmt(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function LseData() {
  const [tab, setTab] = useState<TabId>("catalog");
  const [status, setStatus] = useState<{ configured: boolean; reachable: boolean; error?: string } | null>(null);
  const [datasets, setDatasets] = useState<{ id: string; label: string; count: number }[]>([]);
  const [timeframes, setTimeframes] = useState<string[]>([
    "1s", "5s", "15s", "30s", "1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo",
  ]);

  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catalog
  const [catDataset, setCatDataset] = useState("");
  const [catSearch, setCatSearch] = useState("");

  // Candles
  const [cSymbol, setCSymbol] = useState("NQ");
  const [cTimeframe, setCTimeframe] = useState("1m");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");
  const [cDataset, setCDataset] = useState("");
  const [cAll, setCAll] = useState(false);

  // Chain
  const [chUnderlying, setChUnderlying] = useState("SPY");
  const [chType, setChType] = useState("");
  const [chExpiry, setChExpiry] = useState("");
  const [chMinDte, setChMinDte] = useState("");
  const [chMaxDte, setChMaxDte] = useState("30");

  // Flow
  const [flUnderlying, setFlUnderlying] = useState("");
  const [flType, setFlType] = useState("");
  const [flMinPremium, setFlMinPremium] = useState("100000");
  const [flMaxDte, setFlMaxDte] = useState("");
  const [flStart, setFlStart] = useState("");
  const [flEnd, setFlEnd] = useState("");
  const [flAll, setFlAll] = useState(false);

  // Contract candles
  const [ctTicker, setCtTicker] = useState("");
  const [ctUnderlying, setCtUnderlying] = useState("");
  const [ctStrike, setCtStrike] = useState("");
  const [ctExpiry, setCtExpiry] = useState("");
  const [ctType, setCtType] = useState("call");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/lse/status", { credentials: "include" });
        const j = await r.json();
        if (live) setStatus(j);
      } catch {
        if (live) setStatus({ configured: false, reachable: false, error: "status check failed" });
      }
      try {
        const r = await fetch("/api/lse/catalog?datasets=1", { credentials: "include" });
        const j = await r.json();
        if (live && Array.isArray(j.datasets)) setDatasets(j.datasets);
      } catch { /* picker falls back to a free-text dataset field */ }
      try {
        const r = await fetch("/api/lse/timeframes", { credentials: "include" });
        const j = await r.json();
        if (live && Array.isArray(j.timeframes)) setTimeframes(j.timeframes);
      } catch { /* the hardcoded list above is the same list */ }
    })();
    return () => { live = false; };
  }, []);

  /**
   * Build the query for whichever tab is active. One place, so Preview and
   * Download can never disagree about what is being asked for — the only
   * difference between them is `format=csv`.
   */
  const request = useCallback((): { path: string; params: URLSearchParams } => {
    const p = new URLSearchParams();
    switch (tab) {
      case "catalog":
        if (catDataset) p.set("dataset", catDataset);
        if (catSearch.trim()) p.set("search", catSearch.trim());
        return { path: "/api/lse/catalog", params: p };
      case "candles":
        p.set("symbol", cSymbol.trim().toUpperCase());
        p.set("timeframe", cTimeframe);
        if (cStart.trim()) p.set("start", cStart.trim());
        if (cEnd.trim()) p.set("end", cEnd.trim());
        if (cDataset) p.set("dataset", cDataset);
        if (cAll) p.set("all", "1");
        return { path: "/api/lse/candles", params: p };
      case "chain":
        p.set("underlying", chUnderlying.trim());
        if (chType) p.set("type", chType);
        if (chExpiry.trim()) p.set("expiry", chExpiry.trim());
        if (chMinDte.trim()) p.set("min_dte", chMinDte.trim());
        if (chMaxDte.trim()) p.set("max_dte", chMaxDte.trim());
        return { path: "/api/lse/options-chain", params: p };
      case "flow":
        if (flUnderlying.trim()) p.set("underlying", flUnderlying.trim());
        if (flType) p.set("type", flType);
        if (flMinPremium.trim()) p.set("min_premium", flMinPremium.trim());
        if (flMaxDte.trim()) p.set("max_dte", flMaxDte.trim());
        if (flStart.trim()) p.set("start", flStart.trim());
        if (flEnd.trim()) p.set("end", flEnd.trim());
        if (flAll) p.set("all", "1");
        return { path: "/api/lse/options-flow", params: p };
      case "contract":
      default:
        if (ctTicker.trim()) {
          p.set("ticker", ctTicker.trim().toUpperCase());
        } else {
          p.set("underlying", ctUnderlying.trim());
          p.set("strike", ctStrike.trim());
          p.set("expiry", ctExpiry.trim());
          p.set("type", ctType);
        }
        return { path: "/api/lse/option-candles", params: p };
    }
  }, [
    tab, catDataset, catSearch,
    cSymbol, cTimeframe, cStart, cEnd, cDataset, cAll,
    chUnderlying, chType, chExpiry, chMinDte, chMaxDte,
    flUnderlying, flType, flMinPremium, flMaxDte, flStart, flEnd, flAll,
    ctTicker, ctUnderlying, ctStrike, ctExpiry, ctType,
  ]);

  const preview = useCallback(async () => {
    setBusy(true);
    setError(null);
    setRows([]);
    setMeta("");
    const { path, params } = request();
    if (tab === "catalog") params.set("limit", String(PREVIEW_ROWS * 4));
    try {
      const r = await fetch(`${path}?${params}`, { credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const got: Row[] = Array.isArray(j.rows) ? j.rows : [];
      setRows(got);
      const bits = [`${got.length.toLocaleString("en-US")} rows`];
      if (typeof j.total === "number" && j.total !== got.length) {
        bits.push(`${j.total.toLocaleString("en-US")} match the filter`);
      }
      if (j.start) bits.push(`from ${String(j.start).slice(0, 10)}`);
      if (j.truncated) bits.push("preview capped — use Download CSV for everything");
      if (j.note) bits.push(String(j.note));
      setMeta(bits.join(" · "));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [request, tab]);

  /**
   * Same URL plus format=csv, handed to the browser. A plain navigation keeps
   * the session cookie, streams to disk, and survives a pull far larger than
   * this tab could hold.
   */
  const download = useCallback(() => {
    const { path, params } = request();
    params.set("format", "csv");
    window.location.assign(`${path}?${params}`);
  }, [request]);

  const banner = (() => {
    if (!status) return null;
    if (!status.configured) {
      return {
        tone: OWNER_THEME.red,
        text: "LSE_API_KEY is not set on this server. Add it to .env.local (and on the VPS) and restart.",
      };
    }
    if (!status.reachable) {
      return { tone: OWNER_THEME.gold, text: `Key present, vault unreachable: ${status.error || "unknown error"}` };
    }
    return null;
  })();

  return (
    <div style={homeShellStyle}>
      <div style={{ ...homeContentStyle, overflow: "auto" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "0.01em", color: OWNER_THEME.text }}>
          LSE Data
        </h1>
        <div style={{ fontSize: 13, color: ownerRgba(OWNER_THEME.text, 0.55), marginTop: 4 }}>
          London Strategic Edge vault — catalog, candles, option chains, flow and contract bars. Preview here,
          download the full pull as CSV.
        </div>
      </div>

      {banner ? (
        <div
          style={{
            ...cardStyle,
            padding: "12px 16px",
            border: `1px solid ${ownerRgba(banner.tone, 0.45)}`,
            color: banner.tone,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {banner.text}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              title={t.hint}
              onClick={() => { setTab(t.id); setRows([]); setMeta(""); setError(null); }}
              style={{
                ...(on ? homeButtonStyle : homeSecondaryButtonStyle),
                padding: "8px 14px",
                fontSize: 13,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 12.5, color: ownerRgba(OWNER_THEME.text, 0.45), marginBottom: 14 }}>
          {TABS.find((t) => t.id === tab)?.hint}
        </div>

        <div style={fieldRowStyle}>
          {tab === "catalog" ? (
            <>
              <Field label="Dataset" width={200}>
                <select style={inputStyle} value={catDataset} onChange={(e) => setCatDataset(e.target.value)}>
                  <option value="">All datasets</option>
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>{`${d.label} (${d.count.toLocaleString("en-US")})`}</option>
                  ))}
                </select>
              </Field>
              <Field label="Search" width={220} hint="symbol or company name">
                <input
                  style={inputStyle}
                  value={catSearch}
                  onChange={(e) => setCatSearch(e.target.value)}
                  placeholder="NQ, apple, BTC…"
                />
              </Field>
            </>
          ) : null}

          {tab === "candles" ? (
            <>
              <Field label="Symbol" width={140} hint="exact catalog symbol">
                <input style={inputStyle} value={cSymbol} onChange={(e) => setCSymbol(e.target.value)} placeholder="NQ" />
              </Field>
              <Field label="Timeframe" width={130}>
                <select style={inputStyle} value={cTimeframe} onChange={(e) => setCTimeframe(e.target.value)}>
                  {timeframes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Start" width={150} hint="YYYY-MM-DD, MAX, or blank for 30d">
                <input style={inputStyle} value={cStart} onChange={(e) => setCStart(e.target.value)} placeholder="MAX" />
              </Field>
              <Field label="End" width={150} hint="optional">
                <input style={inputStyle} value={cEnd} onChange={(e) => setCEnd(e.target.value)} placeholder="" />
              </Field>
              <Field label="Dataset" width={170} hint="pin the asset class (rarely needed)">
                <select style={inputStyle} value={cDataset} onChange={(e) => setCDataset(e.target.value)}>
                  <option value="">auto</option>
                  {datasets.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </Field>
              <Field label="Range" width={200} hint="the vault caps one call at 5,000 bars">
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: OWNER_THEME.text }}>
                  <input type="checkbox" checked={cAll} onChange={(e) => setCAll(e.target.checked)} />
                  Walk the whole range
                </label>
              </Field>
            </>
          ) : null}

          {tab === "chain" ? (
            <>
              <Field label="Underlying" width={170} hint="ticker or company name">
                <input style={inputStyle} value={chUnderlying} onChange={(e) => setChUnderlying(e.target.value)} placeholder="SPY" />
              </Field>
              <Field label="Type" width={120}>
                <select style={inputStyle} value={chType} onChange={(e) => setChType(e.target.value)}>
                  <option value="">Both</option>
                  <option value="call">Calls</option>
                  <option value="put">Puts</option>
                </select>
              </Field>
              <Field label="Expiry" width={150} hint="one date, optional">
                <input style={inputStyle} value={chExpiry} onChange={(e) => setChExpiry(e.target.value)} placeholder="2026-09-18" />
              </Field>
              <Field label="Min DTE" width={110}>
                <input style={inputStyle} value={chMinDte} onChange={(e) => setChMinDte(e.target.value)} placeholder="" />
              </Field>
              <Field label="Max DTE" width={110}>
                <input style={inputStyle} value={chMaxDte} onChange={(e) => setChMaxDte(e.target.value)} placeholder="30" />
              </Field>
            </>
          ) : null}

          {tab === "flow" ? (
            <>
              <Field label="Underlying" width={170} hint="blank sweeps the whole tape">
                <input style={inputStyle} value={flUnderlying} onChange={(e) => setFlUnderlying(e.target.value)} placeholder="" />
              </Field>
              <Field label="Type" width={120}>
                <select style={inputStyle} value={flType} onChange={(e) => setFlType(e.target.value)}>
                  <option value="">Both</option>
                  <option value="call">Calls</option>
                  <option value="put">Puts</option>
                </select>
              </Field>
              <Field label="Min premium" width={150}>
                <input style={inputStyle} value={flMinPremium} onChange={(e) => setFlMinPremium(e.target.value)} placeholder="100000" />
              </Field>
              <Field label="Max DTE" width={110}>
                <input style={inputStyle} value={flMaxDte} onChange={(e) => setFlMaxDte(e.target.value)} placeholder="" />
              </Field>
              <Field label="Start" width={150} hint="optional">
                <input style={inputStyle} value={flStart} onChange={(e) => setFlStart(e.target.value)} />
              </Field>
              <Field label="End" width={150} hint="optional">
                <input style={inputStyle} value={flEnd} onChange={(e) => setFlEnd(e.target.value)} />
              </Field>
              <Field label="Range" width={190}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: OWNER_THEME.text }}>
                  <input type="checkbox" checked={flAll} onChange={(e) => setFlAll(e.target.checked)} />
                  Walk the whole tape
                </label>
              </Field>
            </>
          ) : null}

          {tab === "contract" ? (
            <>
              <Field label="OSI ticker" width={220} hint="fills everything below when set">
                <input style={inputStyle} value={ctTicker} onChange={(e) => setCtTicker(e.target.value)} placeholder="AAPL260612C00205000" />
              </Field>
              <Field label="Underlying" width={140}>
                <input style={inputStyle} value={ctUnderlying} onChange={(e) => setCtUnderlying(e.target.value)} placeholder="AAPL" disabled={!!ctTicker.trim()} />
              </Field>
              <Field label="Strike" width={110}>
                <input style={inputStyle} value={ctStrike} onChange={(e) => setCtStrike(e.target.value)} placeholder="205" disabled={!!ctTicker.trim()} />
              </Field>
              <Field label="Expiry" width={150}>
                <input style={inputStyle} value={ctExpiry} onChange={(e) => setCtExpiry(e.target.value)} placeholder="2026-06-12" disabled={!!ctTicker.trim()} />
              </Field>
              <Field label="Type" width={110}>
                <select style={inputStyle} value={ctType} onChange={(e) => setCtType(e.target.value)} disabled={!!ctTicker.trim()}>
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                </select>
              </Field>
            </>
          ) : null}

          <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
            <button type="button" style={{ ...homeSecondaryButtonStyle, opacity: busy ? 0.5 : 1 }} onClick={preview} disabled={busy}>
              {busy ? "Loading…" : "Preview"}
            </button>
            <button type="button" style={homeButtonStyle} onClick={download} disabled={busy}>
              Download CSV
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div style={{ ...cardStyle, padding: "12px 16px", border: `1px solid ${ownerRgba(OWNER_THEME.red, 0.45)}`, color: OWNER_THEME.red, fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      {rows.length ? (
        <div style={cardStyle}>
          <div style={{ fontSize: 12.5, color: ownerRgba(OWNER_THEME.text, 0.55), marginBottom: 12 }}>
            {meta}
            {rows.length > PREVIEW_ROWS
              ? ` · showing the first ${PREVIEW_ROWS.toLocaleString("en-US")}`
              : ""}
          </div>
          <DataTable rows={rows} />
        </div>
      ) : null}

      {!rows.length && !busy && !error ? (
        <div style={{ ...cardStyle, color: ownerRgba(OWNER_THEME.text, 0.45), fontSize: 13 }}>
          Set the filters above, then Preview to see the rows or Download CSV to pull the file.
          Large pulls stream straight to disk — they never load into this tab.
        </div>
      ) : null}
      </div>
    </div>
  );
}
