/**
 * IronCondorTest — EM-based iron-condor builder (test page).
 *
 * Pulls the estimated move for every ticker on the Estimated Moves main roster
 * (ESU / NQU excluded — futures don't get a condor here) and lays the four
 * condor legs onto the expiration's REAL listed strikes:
 *
 *     long put   short put        spot        short call   long call
 *        |           |              |              |            |
 *        └── wing ───┴─ mult × EM ──┴── mult × EM ─┴─── wing ────┘
 *
 * The EM math is the same engine the backend Estimated Moves page uses (copied
 * into src/lib/emCondor.ts so this test page can't disturb the published one).
 * Read-only: nothing here writes to /api/levels or the condor tracker.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME as HT, homeShellStyle } from "../lib/theme";
import { Dock, SegGroup, DockButton, DockGap, DockSpacer, DockSlider, DockExpiryPicker } from "../components/DockToolbar";
import {
  IC_SYMBOLS,
  buildCondor,
  daysTo,
  estimateMoveIC,
  fmtNum,
  getTargetExpiration,
  labelForDate,
  loadExpirations,
  makeEngine,
  type CondorRow,
  type EMQuote,
} from "../lib/emCondor";

type QuoteResult = { ticker: string; quote?: EMQuote; error?: string };

const BATCH = 4;

// Widen the table only where the numbers need it.
const COLS = [
  "Ticker", "Spot", "Exp", "DTE", "EM", "EM %",
  "Long Put", "Short Put", "Short Call", "Long Call",
  "Wing", "Put OTM", "Call OTM",
] as const;

export default function IronCondorTest() {
  const [results, setResults] = useState<QuoteResult[]>([]);
  const [status, setStatus] = useState<{ text: string; color: string }>({ text: "Ready", color: "#eef7ff" });
  const [lastSync, setLastSync] = useState("--");
  const [knownExpirations, setKnownExpirations] = useState<string[]>([]);
  const [weeklyExpirations, setWeeklyExpirations] = useState<string[]>([]);
  const [expOverride, setExpOverride] = useState("");
  const [emMult, setEmMult] = useState(1);
  const [wingSteps, setWingSteps] = useState(2);
  const [sortBy, setSortBy] = useState<"roster" | "emPct">("roster");
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    loadExpirations()
      .then(({ all, weeklies }) => {
        setKnownExpirations(all);
        setWeeklyExpirations(weeklies);
      })
      .catch((e) => console.warn("[IC] expirations:", e));
  }, []);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setStarted(true);
    setResults([]);
    try {
      const engine = makeEngine();
      const effectiveExp = getTargetExpiration(knownExpirations, expOverride);
      if (!effectiveExp) throw new Error("No expiration available");

      const settled: QuoteResult[] = [];
      for (let i = 0; i < IC_SYMBOLS.length; i += BATCH) {
        const batch = IC_SYMBOLS.slice(i, i + BATCH);
        setStatus({
          text: `Loading ${i + 1}-${Math.min(i + BATCH, IC_SYMBOLS.length)} / ${IC_SYMBOLS.length}`,
          color: HT.cyan,
        });
        const out = await Promise.allSettled(batch.map((sym) => estimateMoveIC(sym, effectiveExp, engine)));
        out.forEach((r, idx) => {
          settled.push(r.status === "fulfilled"
            ? { ticker: batch[idx], quote: r.value }
            : { ticker: batch[idx], error: (r.reason as Error)?.message || "Unavailable" });
        });
        setResults([...settled]);
        if (i + BATCH < IC_SYMBOLS.length) await new Promise((res) => setTimeout(res, 300));
      }

      const ok = settled.filter((r) => r.quote).length;
      setStatus({ text: `${ok}/${IC_SYMBOLS.length} priced`, color: ok === IC_SYMBOLS.length ? "#00e676" : "#e8c060" });
      setLastSync(new Date().toLocaleTimeString("en-US", { hour12: false }));
    } catch (e) {
      console.error(e);
      setStatus({ text: (e as Error)?.message || "Failed", color: HT.red });
    } finally {
      setLoading(false);
      busyRef.current = false;
    }
  }, [knownExpirations, expOverride]);

  // Legs are derived, not fetched — moving the sliders re-snaps instantly off
  // the cached chains instead of hammering the chain endpoint again.
  const rows: CondorRow[] = useMemo(() => {
    const built = results.map((r): CondorRow => {
      if (!r.quote) return { ticker: r.ticker, error: r.error || "Unavailable" };
      const q = r.quote;
      const legs = buildCondor(q.close, q.em, q.strikes, emMult, wingSteps);
      const base: CondorRow = {
        ticker: q.ticker,
        close: q.close,
        em: q.em,
        emPct: (q.em / q.close) * 100,
        expiration: q.expiration,
        dte: daysTo(q.expiration),
      };
      if (!legs) return { ...base, error: "Strike ladder too thin for these wings" };
      return { ...base, ...legs };
    });
    if (sortBy === "emPct") {
      return [...built].sort((a, b) => {
        if (a.emPct == null) return 1;
        if (b.emPct == null) return -1;
        return b.emPct - a.emPct;
      });
    }
    return built;
  }, [results, emMult, wingSteps, sortBy]);

  const targetLabel = useMemo(() => {
    const exp = rows.find((r) => r.expiration)?.expiration
      || getTargetExpiration(knownExpirations, expOverride);
    return labelForDate(exp);
  }, [rows, knownExpirations, expOverride]);

  const exportCsv = useCallback(() => {
    const header = [
      "ticker", "spot", "expiration", "dte", "em", "em_pct",
      "long_put", "short_put", "short_call", "long_call",
      "put_width", "call_width", "put_otm_pct", "call_otm_pct",
      "em_mult", "wing_steps", "error",
    ];
    const lines = rows.map((r) => [
      r.ticker,
      r.close ?? "", r.expiration ?? "", r.dte ?? "",
      r.em ?? "", r.emPct != null ? r.emPct.toFixed(3) : "",
      r.longPut ?? "", r.shortPut ?? "", r.shortCall ?? "", r.longCall ?? "",
      r.putWidth ?? "", r.callWidth ?? "",
      r.putOtmPct != null ? r.putOtmPct.toFixed(2) : "",
      r.callOtmPct != null ? r.callOtmPct.toFixed(2) : "",
      emMult, wingSteps, r.error ?? "",
    ].join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `iron-condors-${targetLabel.replace("/", "-")}-${emMult}x-w${wingSteps}.csv`;
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus({ text: "CSV exported", color: "#00e676" });
  }, [rows, emMult, wingSteps, targetLabel]);

  const cell = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: 8,
    borderRight: `1px solid ${HT.border}`,
    color: "#eef7ff",
    ...extra,
  });

  return (
    <div style={{ ...homeShellStyle, flex: 1, minHeight: 0, overflow: "hidden", height: "100%" }}>
      <div style={{ padding: "7px 12px 3px", flexShrink: 0 }}>
        <Dock className="dock-noscroll" flat fullWidth style={{ width: "100%", flexWrap: "wrap", rowGap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: HT.cyan, letterSpacing: ".12em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            Iron Condor Test
          </span>
          <span style={{ fontSize: 12, color: HT.text, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700 }}>
            EM Roster
          </span>
          <DockGap />

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: HT.text, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700 }}>Exp</span>
            <DockExpiryPicker
              expirations={weeklyExpirations}
              value={expOverride}
              onChange={setExpOverride}
              includeFront
              frontLabel="Auto"
            />
          </div>

          <DockSlider
            label="EM ×"
            value={emMult}
            min={0.5}
            max={2}
            step={0.05}
            onChange={setEmMult}
            format={(v) => `${v.toFixed(2)}×`}
            width={92}
            title="Short strikes sit at spot ± this multiple of the estimated move"
          />
          <DockSlider
            label="Wing"
            value={wingSteps}
            min={1}
            max={8}
            step={1}
            onChange={(v) => setWingSteps(Math.round(v))}
            format={(v) => `${Math.round(v)}k`}
            width={78}
            title="Wing width in listed strikes out from each short leg"
          />

          <SegGroup
            options={[
              { label: "Roster", value: "roster" },
              { label: "EM %", value: "emPct" },
            ]}
            active={sortBy}
            onChange={(v) => setSortBy(v as typeof sortBy)}
          />

          <DockSpacer />
          <span style={{ fontSize: 12, color: HT.text, letterSpacing: ".10em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            {lastSync}
          </span>
          <span style={{ fontSize: 12, letterSpacing: ".10em", textTransform: "uppercase", color: status.color, whiteSpace: "nowrap", flexShrink: 0 }}>
            {status.text}
          </span>
          <DockButton
            onClick={refresh}
            title="Fetch estimated moves and rebuild the condors"
            style={{ opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer", color: HT.cyan }}
          >
            {started ? "Refresh" : "Start"}
          </DockButton>
          <DockButton
            onClick={exportCsv}
            title="Export the table as CSV"
            style={{ opacity: rows.length ? 1 : 0.4, cursor: rows.length ? "pointer" : "not-allowed" }}
          >
            Export
          </DockButton>
        </Dock>
      </div>

      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18 }}>
        <div style={{ width: "100%", maxWidth: 1420, margin: "0 auto", background: HT.panelBg, backdropFilter: "blur(16px)", border: `1px solid ${HT.border}`, borderRadius: 8, boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>
          <div style={{ borderBottom: `1px solid ${HT.border}`, background: "rgba(33,158,188,0.04)", padding: "10px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#eef7ff", letterSpacing: ".16em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
              <span>Iron Condors For <span style={{ color: HT.cyan }}>{targetLabel}</span></span>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".1em", padding: "3px 10px", borderRadius: 4, border: "1px solid rgba(232,192,96,.4)", background: "rgba(232,192,96,.08)", color: "#e8c060" }}>
                SHORTS AT {emMult.toFixed(2)}× EM · WINGS {wingSteps} STRIKE{wingSteps === 1 ? "" : "S"}
              </span>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
              <thead style={{ background: HT.panelBgStrong }}>
                <tr style={{ borderBottom: `1px solid ${HT.border}`, color: HT.cyan, textAlign: "center", fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase" }}>
                  {COLS.map((header, idx) => (
                    <th key={header} style={{ padding: 10, whiteSpace: "nowrap", borderRight: idx < COLS.length - 1 ? `1px solid ${HT.border}` : undefined }}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ fontFamily: "Consolas, Monaco, monospace" }}>
                {!started ? (
                  <tr><td colSpan={COLS.length} style={{ padding: 30, textAlign: "center", color: "#eef7ff" }}>Click Start to build condors from the estimated moves</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={COLS.length} style={{ padding: 24, textAlign: "center", color: "#eef7ff" }}>Loading...</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.ticker} title={row.error || ""} style={{ textAlign: "center", borderBottom: `1px solid ${HT.border}`, opacity: row.error ? 0.55 : 1 }}>
                    <td style={cell({ fontWeight: 700, color: "#e8edf5" })}>{row.ticker}</td>
                    {row.error && row.close == null ? (
                      <td colSpan={COLS.length - 1} style={{ padding: 8, color: "#eef7ff", fontStyle: "italic" }}>{row.error}</td>
                    ) : (
                      <>
                        <td style={cell()}>{fmtNum(row.close)}</td>
                        <td style={cell()}>{labelForDate(row.expiration)}</td>
                        <td style={cell()}>{row.dte ?? "--"}</td>
                        <td style={cell({ color: "#e8c060" })}>{fmtNum(row.em)}</td>
                        <td style={cell({ color: "#e8c060" })}>{row.emPct != null ? `${row.emPct.toFixed(2)}%` : "--"}</td>
                        {row.shortPut == null ? (
                          <td colSpan={7} style={{ padding: 8, color: "#eef7ff", fontStyle: "italic" }}>{row.error || "No condor"}</td>
                        ) : (
                          <>
                            <td style={cell({ color: "rgba(239,68,68,.6)" })}>{fmtNum(row.longPut)}</td>
                            <td style={cell({ color: HT.red, fontWeight: 700 })}>{fmtNum(row.shortPut)}</td>
                            <td style={cell({ color: "#00e676", fontWeight: 700 })}>{fmtNum(row.shortCall)}</td>
                            <td style={cell({ color: "rgba(0,230,118,.6)" })}>{fmtNum(row.longCall)}</td>
                            <td style={cell()}>
                              {row.putWidth === row.callWidth
                                ? fmtNum(row.putWidth)
                                : `${fmtNum(row.putWidth)} / ${fmtNum(row.callWidth)}`}
                            </td>
                            <td style={cell({ color: HT.red })}>{row.putOtmPct != null ? `${row.putOtmPct.toFixed(2)}%` : "--"}</td>
                            <td style={{ padding: 8, color: "#00e676" }}>{row.callOtmPct != null ? `${row.callOtmPct.toFixed(2)}%` : "--"}</td>
                          </>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ borderTop: `1px solid ${HT.border}`, padding: "9px 14px", fontSize: 12, color: "#eef7ff", letterSpacing: ".04em" }}>
            Shorts snap to the nearest listed strike beyond spot ± {emMult.toFixed(2)}× EM; wings sit {wingSteps} listed
            strike{wingSteps === 1 ? "" : "s"} further out. Read-only — nothing here publishes to /api/levels or the condor tracker.
          </div>
        </div>
      </div>
    </div>
  );
}
