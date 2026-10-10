/**
 * Contract Dossier · a watchlist on the left, everything CB Edge knows about the
 * selected contract on the right, on one shared timeline.
 *
 *   price      a line of the mark from BEFORE the contract was added, faded,
 *              then the stretch since, with the added price and moment marked
 *   volume     the same bars' volume
 *   OI, IV     the snapshot series /api/watch has recorded since it was added
 *   context    where the strike sits against spot, the walls and the CB
 *
 * LIVE DATA. Reads the CB Edge backend through this app's /api and /proxy
 * reverse proxy; see data.ts for every route and what it can and cannot say.
 * The watchlist IS the owner's probe list (owner.cbedge.net/owner/probe): a
 * contract tracked here shows there and the reverse. Anyone signed in who is not
 * the owner gets look-up mode: open any contract, nothing saved server side.
 *
 * Copy rules hold: no em-dashes in anything a person reads, and never buy,
 * sell, signal, entry, target, stop or prediction. Mechanics and locations only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { PageShell } from "../../components/PageCard";
import {
  ACCENT, ACCENT_TEXT, BAD, ELEV, GOOD, INK, LINE, MONO, PANEL, PAPER, PAPER_QUIET, R_LG, R_MD, SKY,
  W_BOLD, W_DATA, labelStyle, numStyle, rgba,
} from "../../theme";
import { Btn, Pill, Seg, inputStyle, load, save } from "../spreadDesk/ui";
import type { Bar, Contract, Levels, Live, RangeKey, WatchRow, WatchSnapshot } from "./data";
import {
  HttpError, addToWatch, contractKey, dte, fetchBars, fetchLevels, fetchLive, fetchWatchHistory, fetchWatchlist,
  fmtBig, fmtCount, fmtExpiry, fmtMD, fmtMDT, fmtPct, fmtPx, fmtSigned, ivPct, label, parseContract, refreshWatch,
  removeFromWatch, sameContract,
} from "./data";
import { LevelRuler, Pane, PricePane, SincePane, Spark, VolumePane, XAxis, makeTimeline, useWidth } from "./charts";

type WatchState = "loading" | "ok" | "denied" | "error";
const RECENT_KEY = "dossier.recent.v1";
const RANGE_KEY = "dossier.range.v1";

const encodeC = (c: Contract) => `${c.ticker}-${c.expiry}-${c.strike}-${c.side}`;
function decodeC(s: string): Contract | null {
  const m = s.match(/^([A-Z./]{1,7})-(\d{4}-\d{2}-\d{2})-(\d+(?:\.\d+)?)-([CP])$/);
  return m ? { ticker: m[1], expiry: m[2], strike: Number(m[3]), side: m[4] as "C" | "P" } : null;
}
const readHashC = () => {
  try {
    return decodeC(decodeURIComponent(window.location.hash.slice(1)));
  } catch {
    return null;
  }
};

export default function ContractDossier() {
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [watch, setWatch] = useState<WatchState>("loading");
  const [watchErr, setWatchErr] = useState<string | null>(null);
  const [hist, setHist] = useState<Record<number, WatchSnapshot[]>>({});
  const [sel, setSel] = useState<Contract | null>(readHashC);
  const [recent, setRecent] = useState<Contract[]>(() => load<Contract[]>(RECENT_KEY) ?? []);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadWatch = useCallback(async () => {
    try {
      const list = await fetchWatchlist();
      setRows(list);
      setWatch("ok");
      setWatchErr(null);
      return list;
    } catch (e) {
      const st = e instanceof HttpError ? e.status : 0;
      setWatch(st === 401 || st === 403 ? "denied" : "error");
      setWatchErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    loadWatch().then((list) => {
      if (list?.length) setSel((cur) => cur ?? list[0]);
    });
  }, [loadWatch]);

  // The snapshot series per tracked row, for the sparklines and the OI / IV panes.
  useEffect(() => {
    if (watch !== "ok" || !rows.length) return;
    const ac = new AbortController();
    rows.forEach((r) => {
      fetchWatchHistory(r.id, ac.signal)
        .then((h) => setHist((m) => ({ ...m, [r.id]: h })))
        .catch(() => { /* a row with no history keeps its "building" spark */ });
    });
    return () => ac.abort();
  }, [rows, watch]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const select = useCallback((c: Contract) => {
    setSel(c);
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${encodeC(c)}`);
    } catch { /* ignore */ }
  }, []);

  const remember = useCallback((c: Contract) => {
    setRecent((list) => {
      const next = [c, ...list.filter((x) => !sameContract(x, c))].slice(0, 8);
      save(RECENT_KEY, next);
      return next;
    });
  }, []);

  const selRow = useMemo(() => (sel ? rows.find((r) => sameContract(r, sel)) ?? null : null), [rows, sel]);

  const onTrack = useCallback(async (c: Contract) => {
    try {
      await addToWatch(c);
      const list = await loadWatch();
      const row = list?.find((r) => sameContract(r, c));
      if (row) select(row);
      setToast(`✓ Tracking ${label(c)} · it also shows on your CB Edge probe page`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  }, [loadWatch, select]);

  const onRemove = useCallback(async (r: WatchRow) => {
    try {
      await removeFromWatch(r.id);
      setRows((list) => list.filter((x) => x.id !== r.id));
      setToast(`Removed ${label(r)}`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await refreshWatch();
      setRows(list);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <PageShell
      title="Contract dossier"
      lede="Pick a contract and see its whole life, not just the part since you added it: price and volume from before you were watching, open interest and IV since, and where the strike sits against the walls."
      maxWidth={1440}
    >
      <style>{CSS}</style>
      <div className="cd-wrap">
        <WatchPanel
          rows={rows}
          watch={watch}
          watchErr={watchErr}
          hist={hist}
          sel={sel}
          recent={recent}
          refreshing={refreshing}
          onSelect={(c) => { select(c); remember(c); }}
          onTrack={onTrack}
          onRemove={onRemove}
          onRefresh={onRefresh}
        />
        {sel ? (
          <Dossier
            key={contractKey(sel)}
            c={sel}
            row={selRow}
            snaps={selRow ? hist[selRow.id] ?? [] : []}
            canTrack={watch === "ok"}
            onTrack={() => onTrack(sel)}
          />
        ) : (
          <EmptyDossier watch={watch} />
        )}
      </div>
      {toast && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 400, background: ELEV, border: `1px solid ${rgba(ACCENT, 0.5)}`, borderRadius: R_MD, padding: "10px 14px", fontSize: 13, color: PAPER, boxShadow: "0 10px 30px rgba(0,0,0,.5)" }}>
          {toast}
        </div>
      )}
    </PageShell>
  );
}

/* ── the watchlist ────────────────────────────────────────────────────────── */

function WatchPanel({
  rows, watch, watchErr, hist, sel, recent, refreshing, onSelect, onTrack, onRemove, onRefresh,
}: {
  rows: WatchRow[];
  watch: WatchState;
  watchErr: string | null;
  hist: Record<number, WatchSnapshot[]>;
  sel: Contract | null;
  recent: Contract[];
  refreshing: boolean;
  onSelect: (c: Contract) => void;
  onTrack: (c: Contract) => void;
  onRemove: (r: WatchRow) => void;
  onRefresh: () => void;
}) {
  const [q, setQ] = useState("");
  const [armed, setArmed] = useState<number | null>(null);
  const parsed = parseContract(q);
  const tracked = parsed ? rows.some((r) => sameContract(r, parsed)) : false;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed) onSelect(parsed);
  };

  return (
    <section className="cd-panel" style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG, minWidth: 0, alignSelf: "start" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${LINE}` }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: W_BOLD, color: PAPER }}>Watchlist</h3>
        {watch === "ok" && <span style={{ ...labelStyle }}>{rows.length} tracked</span>}
        <div style={{ flex: 1 }} />
        {watch === "ok" && <Btn small kind="ghost" onClick={onRefresh} disabled={refreshing}>{refreshing ? "Refreshing" : "↻ Refresh"}</Btn>}
      </div>

      <form onSubmit={submit} style={{ padding: "12px 14px", borderBottom: `1px solid ${LINE}`, display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 8 }}>
        <input
          aria-label="Contract shortcut"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="TSLA 420c 7/17"
          spellCheck={false}
          autoComplete="off"
          style={{ ...inputStyle, boxSizing: "border-box", fontSize: 13.5, padding: "10px 12px" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 30, minWidth: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: parsed ? PAPER : PAPER_QUIET, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {parsed ? `${label(parsed)} · ${fmtExpiry(parsed.expiry)} · ${dte(parsed.expiry)} DTE` : "ticker · strike + c or p · expiry"}
          </span>
          <Btn small kind="ghost" type="submit" disabled={!parsed}>Open</Btn>
          {watch === "ok" && (
            <Btn small disabled={!parsed || tracked} done={tracked} onClick={() => parsed && onTrack(parsed)}>
              {tracked ? "Tracked" : "Track"}
            </Btn>
          )}
        </div>
      </form>

      {watch === "loading" && <div style={{ padding: 16, fontSize: 12.5, color: PAPER_QUIET }}>Reading your watchlist…</div>}

      {watch === "denied" && (
        <div style={{ padding: "14px", display: "grid", gap: 8, justifyItems: "start" }}>
          <Pill tone="accent">Look-up mode</Pill>
          <div style={{ fontSize: 12.5, color: PAPER, lineHeight: 1.5 }}>
            The watchlist is the owner's CB Edge probe list, so it only loads for the owner. Type any contract above and Open it: the dossier reads the same feed either way.
          </div>
        </div>
      )}

      {watch === "error" && (
        <div style={{ padding: 14, fontSize: 12.5, color: PAPER, lineHeight: 1.5 }}>
          The watchlist did not load ({watchErr}). Contracts you type above still open.
        </div>
      )}

      {watch === "ok" && rows.length === 0 && (
        <div style={{ padding: 14, fontSize: 12.5, color: PAPER_QUIET }}>Nothing tracked yet. Type a contract above and press Track.</div>
      )}

      {watch === "ok" && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="cd-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Contract</th>
                <th>Added</th>
                <th>Now</th>
                <th>P/L</th>
                <th>Since added</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = sel != null && sameContract(r, sel);
                const now = r.snapshot?.mark ?? null;
                const pl = r.added_price && now ? (now / r.added_price - 1) * 100 : null;
                return (
                  <tr key={r.id} className={on ? "on" : ""} onClick={() => onSelect(r)} style={{ cursor: "pointer" }}>
                    <td style={{ textAlign: "left" }}>
                      <span style={{ fontFamily: "inherit", fontWeight: W_BOLD, color: PAPER, fontSize: 13 }}>{r.ticker}</span>{" "}
                      <span style={{ color: ACCENT_TEXT }}>{r.strike % 1 ? r.strike : r.strike.toFixed(0)}{r.side}</span>
                      <div style={{ fontSize: 10.5, color: PAPER_QUIET, marginTop: 3 }}>{fmtExpiry(r.expiry)}</div>
                    </td>
                    <td>{fmtPx(r.added_price)}</td>
                    <td>{fmtPx(now)}</td>
                    <td style={{ color: pl == null ? PAPER_QUIET : pl >= 0 ? GOOD : BAD, fontWeight: 700 }}>{pl == null ? "·" : fmtSigned(pl, 0)}</td>
                    <td style={{ padding: "4px 6px" }}><Spark snaps={hist[r.id]} added={r.added_price} /></td>
                    <td style={{ padding: "0 6px" }}>
                      <button
                        type="button"
                        aria-label={armed === r.id ? `Confirm remove ${label(r)}` : `Remove ${label(r)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (armed === r.id) {
                            setArmed(null);
                            onRemove(r);
                          } else {
                            setArmed(r.id);
                            window.setTimeout(() => setArmed((a) => (a === r.id ? null : a)), 3000);
                          }
                        }}
                        style={{ border: 0, background: armed === r.id ? rgba(BAD, 0.14) : "transparent", color: armed === r.id ? BAD : PAPER_QUIET, borderRadius: 6, padding: "4px 7px", cursor: "pointer", fontFamily: MONO, fontSize: armed === r.id ? 10.5 : 13, whiteSpace: "nowrap" }}
                      >
                        {armed === r.id ? "remove?" : "×"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {watch !== "ok" && recent.length > 0 && (
        <div style={{ padding: "6px 14px 14px", display: "grid", gap: 6 }}>
          <div style={{ ...labelStyle }}>Opened recently · this browser</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {recent.map((c) => (
              <button key={contractKey(c)} type="button" onClick={() => onSelect(c)}
                style={{ border: `1px solid ${LINE}`, background: INK, color: PAPER, borderRadius: 6, padding: "4px 8px", fontFamily: MONO, fontSize: 11.5, cursor: "pointer" }}>
                {label(c)} {fmtMD(Date.parse(`${c.expiry}T16:00:00Z`))}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: "10px 14px 14px", fontSize: 11.5, color: PAPER_QUIET, lineHeight: 1.5, borderTop: watch === "ok" && rows.length ? `1px solid ${LINE}` : "none" }}>
        {watch === "ok"
          ? "Same list as your CB Edge probe page. Tracking a contract here adds it there too. The sparkline is the mark since you added it."
          : "Live CB Edge feed. Nothing you open here is saved server side."}
      </div>
    </section>
  );
}

/* ── the dossier ──────────────────────────────────────────────────────────── */

function Dossier({ c, row, snaps, canTrack, onTrack }: { c: Contract; row: WatchRow | null; snaps: WatchSnapshot[]; canTrack: boolean; onTrack: () => void }) {
  const [range, setRangeState] = useState<RangeKey>(() => load<RangeKey>(RANGE_KEY) ?? "1m");
  const setRange = (r: RangeKey) => { setRangeState(r); save(RANGE_KEY, r); };
  const [raw, setRaw] = useState<{ bars: Bar[]; interval: string } | null>(null);
  const [barsErr, setBarsErr] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [levels, setLevels] = useState<Levels | null | undefined>(undefined);
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();

  // price history for the window
  useEffect(() => {
    const ac = new AbortController();
    setRaw(null);
    setBarsErr(null);
    fetchBars(c, range, ac.signal)
      .then((r) => setRaw(r))
      .catch((e) => { if (!ac.signal.aborted) setBarsErr(e instanceof Error ? e.message : String(e)); });
    return () => ac.abort();
  }, [c, range]);

  // live quote + greeks, then every 30s while the tab is visible
  const liveTimer = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      if (document.visibilityState !== "visible") return;
      fetchLive(c)
        .then((l) => { if (alive) { setLive(l); setLiveErr(l ? null : "no quote for this contract right now"); } })
        .catch((e) => { if (alive) setLiveErr(e instanceof Error ? e.message : String(e)); });
    };
    pull();
    liveTimer.current = window.setInterval(pull, 30_000);
    return () => {
      alive = false;
      if (liveTimer.current) window.clearInterval(liveTimer.current);
    };
  }, [c]);

  useEffect(() => {
    const ac = new AbortController();
    setLevels(undefined);
    fetchLevels(c.ticker, ac.signal).then(setLevels).catch(() => { if (!ac.signal.aborted) setLevels(null); });
    return () => ac.abort();
  }, [c.ticker]);

  const daily = range !== "5d";
  // Raw bars, no roll-up: the server already scales the interval with the window
  // (15m for 5D, 1h for 1M, 4h for 3M), which keeps every view near 130 points.
  const bars = raw?.bars ?? [];
  const tl = useMemo(() => makeTimeline(bars.map((b) => b.t), width), [bars, width]);

  const addedAt = row?.created_at ?? null;
  const added = row?.added_price ?? null;
  const lastSnap = snaps.length ? snaps[snaps.length - 1] : row?.snapshot ?? null;
  const now = live?.mark ?? lastSnap?.mark ?? (bars.length ? bars[bars.length - 1].c : null);
  const since = added && now ? (now / added - 1) * 100 : null;
  const day = live?.prevClose && now ? (now / live.prevClose - 1) * 100 : null;
  const hiBar = bars.length ? Math.max(...bars.map((b) => b.c)) : null;
  const loBar = bars.length ? Math.min(...bars.map((b) => b.c)) : null;
  const fromHi = hiBar && now ? (now / hiBar - 1) * 100 : null;
  const iv = ivPct(live?.iv ?? lastSnap?.iv ?? null);
  const delta = live?.delta ?? lastSnap?.delta ?? null;
  const theta = live?.theta ?? lastSnap?.theta ?? null;
  const spot = live?.spot ?? lastSnap?.spot ?? null;
  const dd = dte(c.expiry);
  const expired = dd < 0;

  const hb = hover != null ? bars[hover] : null;
  const addedLabel = addedAt != null && added != null ? `ADDED ${fmtMD(addedAt)} @ ${fmtPx(added)}` : null;
  const addedInWindow = addedAt != null && bars.length > 0 && addedAt >= bars[0].t;

  // context numbers
  const isCall = c.side === "C";
  const toStrike = spot ? (c.strike / spot - 1) * 100 : null;
  const breakeven = now ? (isCall ? c.strike + now : c.strike - now) : null;
  const toBe = spot && breakeven ? (breakeven / spot - 1) * 100 : null;
  const vsCb = levels?.cb ? c.strike - levels.cb : null;

  return (
    <section className="cd-dossier" style={{ background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_LG, boxShadow: "0 8px 26px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.045)", padding: "18px 20px", minWidth: 0 }}>
      {/* header */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <b style={{ fontSize: 20, color: PAPER }}>{c.ticker}</b>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: ACCENT_TEXT, background: rgba(SKY, 0.1), border: `1px solid ${rgba(SKY, 0.22)}`, borderRadius: 6, padding: "3px 8px" }}>
          {c.strike % 1 ? c.strike : c.strike.toFixed(0)}{c.side}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: PAPER_QUIET }}>
          {fmtExpiry(c.expiry)} · {expired ? "expired" : `${dd} DTE`}
          {addedAt != null ? ` · added ${fmtMD(addedAt)}` : ""}
          {row?.note ? ` · ${row.note}` : ""}
        </span>
        {!row && (canTrack
          ? <Btn small onClick={onTrack}>Track it</Btn>
          : <Pill tone="plain">Not tracked</Pill>)}
        <div style={{ flex: 1 }} />
        <div style={{ width: 170 }}>
          <Seg label="Window" value={range} onChange={setRange} options={[["5d", "5D"], ["1m", "1M"], ["3m", "3M"]]} />
        </div>
      </div>

      {/* stats */}
      <div className="cd-stats">
        <div>
          <div style={{ ...labelStyle }}>{added ? "Since added" : "Today"}</div>
          <div style={{ ...numStyle, fontWeight: W_DATA, fontSize: 28, letterSpacing: "-0.02em", color: tone(added ? since : day) }}>
            {fmtPct(added ? since : day)}
          </div>
        </div>
        <Stat k={added ? "Added → now" : "Mark"} v={added ? `${fmtPx(added)} → ${fmtPx(now)}` : fmtPx(now)}
          s={live?.bid != null && live?.ask != null ? `${fmtPx(live.bid)} × ${fmtPx(live.ask)}` : liveErr ?? undefined} />
        <Stat k={`${range.toUpperCase()} range`} v={loBar != null && hiBar != null ? `${fmtPx(loBar)} to ${fmtPx(hiBar)}` : "·"} />
        <Stat k="From the high" v={fmtPct(fromHi, 0)} color={tone(fromHi)} />
        <Stat k="IV · Δ · Θ" v={`${iv != null ? `${iv.toFixed(0)}%` : "·"} · ${greek(delta)} · ${greek(theta)}`} />
        <Stat k="OI · volume" v={`${fmtCount(live?.oi ?? lastSnap?.open_interest)} · ${fmtCount(live?.volume ?? lastSnap?.volume)}`} />
      </div>

      {/* hover readout */}
      <div style={{ minHeight: 20, marginTop: 10, fontFamily: MONO, fontSize: 11.5, color: PAPER, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {hb ? (
          <>
            <span style={{ color: ACCENT_TEXT }}>{fmtMDT(hb.t)}</span>
            <span>Mark {fmtPx(hb.c)}</span>
            <span>Vol {fmtCount(hb.v)}</span>
            {added && <span style={{ color: tone(hb.c / added - 1) }}>vs added {fmtSigned((hb.c / added - 1) * 100, 1)}</span>}
          </>
        ) : (
          <span style={{ color: PAPER_QUIET }}>
            {addedAt != null && !addedInWindow && bars.length
              ? `Added ${fmtMD(addedAt)}, before this window. Widen it to see the marker.`
              : "Hover the chart to read the price at any point."}
          </span>
        )}
      </div>

      {/* panes */}
      <div ref={ref} style={{ marginTop: 6, minHeight: 200 }}>
        {width > 0 && raw == null && !barsErr && <Shimmer text="Pulling the contract's price history…" />}
        {barsErr && <Shimmer text={`Price history did not load (${barsErr}).`} />}
        {width > 0 && raw != null && bars.length === 0 && (
          <Shimmer text="No price bars for this window. A contract that has not traded, or one listed after the window starts, has none to draw." />
        )}
        {width > 0 && bars.length > 0 && (
          <>
            <Pane title="Price" sub={`option mark · ${raw?.interval || "bars"}${addedInWindow ? " · faded = before you added it" : ""}`} first>
              <PricePane bars={bars} tl={tl} width={width} addedAt={addedInWindow ? addedAt : null} addedPrice={added}
                hover={hover} onHover={setHover} addedLabel={addedInWindow ? addedLabel : null} />
            </Pane>
            <Pane title="Volume" sub={`per ${raw?.interval || "bar"}`}>
              <VolumePane bars={bars} tl={tl} width={width} addedAt={addedInWindow ? addedAt : null} hover={hover} />
            </Pane>
            <Pane title="Open interest" sub="recorded since added">
              <SincePane snaps={snaps} pick={(s) => s.open_interest} tl={tl} width={width} fmt={fmtCount} hoverT={hb?.t ?? null}
                emptyText={row ? "Building · OI is recorded from the day a contract is added, one reading per refresh." : "Track this contract to start recording its open interest."} />
            </Pane>
            <Pane title="Implied vol" sub="recorded since added">
              <SincePane snaps={snaps} pick={(s) => ivPct(s.iv)} tl={tl} width={width} fmt={(v) => `${v.toFixed(1)}%`} hoverT={hb?.t ?? null}
                emptyText={row ? "Building · IV is recorded from the day a contract is added." : "Track this contract to start recording its IV."} />
            </Pane>
            <XAxis tl={tl} daily={daily} />
          </>
        )}
      </div>

      {/* context */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
        <div style={{ ...labelStyle, color: PAPER }}>Where this strike sits</div>
        <div style={{ marginTop: 6 }}>
          {width > 0 && (spot != null || levels) && <LevelRuler levels={levels ?? null} spot={spot} strike={c.strike} width={width} />}
          {levels === null && (
            <div style={{ fontSize: 12, color: PAPER_QUIET, margin: "6px 0 2px" }}>
              No wall history for {c.ticker} on the CB Edge scanner, so only spot and your strike are drawn.
            </div>
          )}
        </div>
        <div className="cd-ctx">
          <Stat k="To the strike" v={fmtSigned(toStrike, 1)} s={spot ? `spot ${fmtPx(spot)}` : undefined} />
          <Stat k="Breakeven at expiry" v={fmtPx(breakeven)} s={toBe != null ? `${fmtSigned(toBe, 1)} from spot` : undefined} />
          <Stat k="Strike vs CB" v={vsCb != null ? `${vsCb >= 0 ? "+" : "−"}${Math.abs(vsCb).toFixed(vsCb % 1 ? 1 : 0)} pts` : "·"}
            s={levels?.cb ? `CB ${levels.cb}${levels.date ? ` · ${fmtMD(Date.parse(`${levels.date}T16:00:00Z`))}` : ""}` : undefined} />
          <Stat k="Net GEX at strike" v={fmtBig(lastSnap?.net_gex)} s={row ? "call + put, OI + volume" : "recorded once tracked"} />
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 11.5, color: PAPER_QUIET, lineHeight: 1.5 }}>
        Price and volume: dxLink candles via /proxy/option-history. Quote and greeks: TastyTrade, refreshed every 30s. OI, IV and net GEX: the
        snapshots your watchlist records. Walls and CB: the scanner's 15 minute log. Analytics, not advice.
      </div>
    </section>
  );
}

function EmptyDossier({ watch }: { watch: WatchState }) {
  return (
    <section style={{ background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_LG, padding: 28, minHeight: 320, display: "grid", placeItems: "center", textAlign: "center" }}>
      <div style={{ maxWidth: 420, display: "grid", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: W_BOLD, color: PAPER }}>No contract open</div>
        <div style={{ fontSize: 13, color: PAPER_QUIET, lineHeight: 1.55 }}>
          {watch === "loading" ? "Reading your watchlist…" : "Type one on the left, like TSLA 420c 7/17, and press Open."}
        </div>
      </div>
    </section>
  );
}

function Stat({ k, v, s, color }: { k: string; v: string; s?: string; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...labelStyle }}>{k}</div>
      <div style={{ ...numStyle, fontWeight: 700, fontSize: 16, color: color ?? PAPER, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
      {s && <div style={{ fontSize: 11.5, color: PAPER_QUIET, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s}</div>}
    </div>
  );
}

function Shimmer({ text }: { text: string }) {
  return (
    <div style={{ height: 200, display: "grid", placeItems: "center", border: `1px dashed ${LINE}`, borderRadius: R_MD, color: PAPER_QUIET, fontSize: 12.5, padding: 16, textAlign: "center" }}>
      {text}
    </div>
  );
}

/** 0.12 → ".12", -0.09 → "−.09": the greeks fit one stat cell. */
const greek = (v: number | null) => (v == null ? "·" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(2).replace(/^0/, "")}`);

const tone = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? PAPER : v >= 0 ? GOOD : BAD);

const CSS = `
.cd-wrap{display:grid;grid-template-columns:420px minmax(0,1fr);gap:18px;align-items:start}
.cd-stats{display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(0,1.15fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,1.2fr) minmax(0,1fr);gap:14px 18px;align-items:end;margin-top:14px}
.cd-ctx{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px 18px;margin-top:10px}
.cd-table{width:100%;border-collapse:collapse}
.cd-table th{font-family:${MONO};font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:${PAPER_QUIET};text-align:right;padding:9px 8px;border-bottom:1px solid ${LINE};white-space:nowrap}
.cd-table td{font-family:${MONO};font-variant-numeric:tabular-nums;font-size:12px;color:${PAPER};text-align:right;padding:10px 8px;border-bottom:1px solid ${LINE};white-space:nowrap}
.cd-table tbody tr:hover td{background:${rgba(ACCENT, 0.06)}}
.cd-table tr.on td{background:${rgba(ACCENT, 0.12)}}
.cd-table tr.on td:first-child{box-shadow:inset 2px 0 0 ${ACCENT}}
@media (max-width:1100px){
  .cd-wrap{grid-template-columns:1fr}
  .cd-stats{grid-template-columns:repeat(3,minmax(0,1fr))}
  .cd-stats > div:first-child{grid-column:1 / -1}
}
@media (max-width:640px){
  .cd-stats,.cd-ctx{grid-template-columns:repeat(2,minmax(0,1fr))}
  .cd-dossier{padding:14px!important}
}
`;
