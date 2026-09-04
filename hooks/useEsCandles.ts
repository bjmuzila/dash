"use client";

/**
 * useEsCandles — single source of truth for 5-minute ES futures candles.
 *
 * - Loads today's bars + ~20 days of history from SQLite on mount.
 * - Connects to the server-v2 broadcaster at /ws/gex and merges live `esCandles`
 *   messages (and the `esCandles` field of the initial `snapshot`).
 * - Computes per-slot average volume baselines over the previous 5 and 14
 *   trading days, attached to each of today's bars as avg5 / avg14.
 *
 * Consumed by the Relative Volume card and the live IB Logic component.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { subscribeGex, type GexMessage } from "@/lib/gexSocket";
import { useRefreshSource } from "@/lib/refreshBus";

// BOTH candle topics, always. The 1m/5m choice is read from `intervalRef`
// inside the handler specifically so switching aggregation does NOT tear down
// the subscription — which means the socket cannot know in advance which one
// will be wanted, and asking for only the current one would make the toggle
// silently dead until a remount.
//
// Scoping this to the ACTIVE interval was tried and reverted. It does halve
// candle bandwidth at the default 5m (every es1mCandles frame is currently
// parsed, fanned out to every subscriber, and discarded by all of them) — but
// the narrow-then-widen sequence on a 1m<->5m toggle makes gexSocket take the
// reopenWithScope() path: a real WebSocket close/open that clears the replay
// cache and bounces onStatus for EVERY consumer on the page, including the
// other two chart cards and the toolbar ticker. A visible reconnect blip on a
// routine timeframe click is a worse trade than the bytes.
//
// "regime-fit-updated" / "pairs-regime-updated" are deliberately absent: the
// server pushes those through broadcastEvent(), which ignores client topics
// entirely, so they arrive either way.
const ES_CANDLE_TOPICS = ["esCandles", "es1mCandles"] as const;
import {
  queryEsCandlesToday,
  queryEsCandlesHistorical,
  type EsCandleRecord,
} from "@/lib/snapdb";

export interface EsCandle extends EsCandleRecord {
  avg5?: number;   // avg volume for this 5m slot over previous 5 trading days
  avg14?: number;  // avg volume for this 5m slot over previous 14 trading days
}

function todayETStr(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

function slotTimeOf(c: EsCandleRecord): string {
  // "YYYY-MM-DDTHH:MM" -> "HH:MM"
  return (c.slotKey ?? "").slice(11, 16) || (c.time ?? "").slice(0, 5);
}

function dateOf(c: EsCandleRecord): string {
  return c.date ?? (c.slotKey ?? "").slice(0, 10);
}

/**
 * Average volume per 5-min slot over the last `nDays` distinct trading days
 * (excluding today). Returns a map "HH:MM" -> avg volume.
 */
function buildSlotAverages(historical: EsCandleRecord[], today: string, nDays: number): Map<string, number> {
  // Most recent nDays distinct past dates.
  const dates = [...new Set(historical.map(dateOf).filter((d) => d && d < today))].sort().reverse().slice(0, nDays);
  const dateSet = new Set(dates);
  const acc = new Map<string, { sum: number; days: Set<string> }>();
  for (const c of historical) {
    const d = dateOf(c);
    if (!dateSet.has(d)) continue;
    const vol = Number(c.volume || 0);
    if (!(vol > 0)) continue;
    const slot = slotTimeOf(c);
    if (!slot) continue;
    const e = acc.get(slot) ?? { sum: 0, days: new Set() };
    e.sum += vol;
    e.days.add(d);
    acc.set(slot, e);
  }
  const out = new Map<string, number>();
  for (const [slot, e] of acc) {
    if (e.days.size) out.set(slot, e.sum / e.days.size);
  }
  return out;
}

// ── Cross-instance load sharing ──────────────────────────────────────────────
// The ES Candles page mounts up to THREE charts, each with its own copy of this
// hook, and they all wake up within a few ms of each other asking SQLite for the
// same two things. `dedupeFetch` can't help — these go through the snapdb layer,
// not through fetch() — so share at this level instead.
//
// Deliberately a short TTL, not a cache. The "today" query's answer changes as
// bars print, so holding it would freeze the chart; 3s is long enough to collapse
// a mount storm (and a StrictMode double-invoke) and short enough that a manual
// refresh a moment later still hits the database.
const LOAD_SHARE_MS = 3_000;
const loadShare = new Map<string, { at: number; p: Promise<PromiseSettledResult<EsCandleRecord[]>[]> }>();

function sharedLoad(
  key: string,
  run: () => Promise<PromiseSettledResult<EsCandleRecord[]>[]>,
): Promise<PromiseSettledResult<EsCandleRecord[]>[]> {
  const hit = loadShare.get(key);
  if (hit && Date.now() - hit.at < LOAD_SHARE_MS) return hit.p;
  const p = run();
  loadShare.set(key, { at: Date.now(), p });
  // Drop on settle so a failure is never remembered — the next caller retries.
  p.catch(() => {}).then(() => {
    const cur = loadShare.get(key);
    if (cur && cur.p === p && Date.now() - cur.at >= LOAD_SHARE_MS) loadShare.delete(key);
  });
  return p;
}

/**
 * @param enabled  When false, the hook does NOT load from SQLite or open the
 *   /ws/gex socket — it stays fully idle (no connection, no bandwidth). Flipping
 *   it true connects on demand; flipping back to false tears the socket down.
 *   Defaults to true so existing always-on callers are unchanged.
 * @param historyDays  How many prior sessions of candles to pull on load. Only
 *   the fail-rate stats need the full ~20; the live /fails panels only need
 *   last week + yesterday, so they pass a smaller window (e.g. 8) to cut the
 *   initial payload. Defaults to 20 so existing callers are unchanged.
 * @param intervalMinutes  Bar aggregation: 5 (default) or 1.
 *
 *   These are two SEPARATE server streams, not two views of one — dxLink
 *   aggregates by the {=Nm} suffix, so 1m detail does not exist inside the 5m
 *   feed and cannot be derived from it. At 1 the hook reads `es1mCandles` WS
 *   frames and es_candles rows WHERE intervalMinutes=1; at 5, `esCandles` and
 *   intervalMinutes=5. The two share a slotKey space (09:30 is 09:30 either
 *   way), so mixing them would interleave two aggregations into one series —
 *   hence the hard split rather than a merge.
 *
 *   1m is server-gated by ES_1M_CANDLES=1. With it off, the WS frames never
 *   arrive and only DB history renders.
 */
/**
 * Stable empty array for the `candles` result when averages are not requested.
 * A fresh `[]` per render would defeat every downstream memo that depends on it.
 */
const EMPTY_CANDLES: EsCandle[] = [];

export function useEsCandles(
  enabled: boolean = true,
  historyDays: number = 20,
  intervalMinutes: 1 | 5 = 5,
  /**
   * Compute the 5/14-day per-slot volume averages attached to `candles`.
   *
   * Defaults to TRUE so every existing caller behaves exactly as before. Pass
   * false from consumers that only want `sessionCandles` / `historical` — see
   * the note on the memo itself for what it costs.
   */
  withAverages: boolean = true,
) {
  // Final gate = global bandwidth lifecycle AND the caller's enable flag.
  const lifecycle = useWsLifecycle();
  const shouldConnect = lifecycle && enabled;
  // Read inside the WS handler. A ref, not a dep: the socket effect keys on
  // `shouldConnect` alone, so switching aggregation must not drop and re-open the
  // connection — the server sends both streams regardless, we just change which
  // one we listen to.
  const intervalRef = useRef<1 | 5>(intervalMinutes);
  intervalRef.current = intervalMinutes;
  const [todayRows, setTodayRows] = useState<EsCandleRecord[]>([]);
  const [historical, setHistorical] = useState<EsCandleRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const liveMapRef = useRef<Map<string, EsCandleRecord>>(new Map());
  // Live bars for the rolling-session view, kept REGARDLESS of date so the
  // overnight session (prior-day-dated bars) survives — liveMapRef above is
  // today-only and feeds `candles` (IB / RelVol consumers expect today-only).
  const sessionMapRef = useRef<Map<string, EsCandleRecord>>(new Map());
  const [sessionTick, setSessionTick] = useState(0);
  // (wsRef / reconnectRef are gone — the socket and its backoff are owned by
  // lib/gexSocket now; this hook just subscribes.)
  const unmountedRef = useRef(false);
  // ── Re-render coalescing ───────────────────────────────────────────────────
  // The /ws/gex feed pushes candle frames continuously, and EVERY frame used to
  // fire both setState calls below. A 5-minute bar whose close ticks 40×/sec
  // does not need 40 re-renders: each one re-derives `candles` (two 20-day
  // buildSlotAverages passes) and `sessionCandles` (Map + sort), and on the
  // ES-candles page that cascades into rows → sessionLevels/profile/tpoProfiles
  // → full setData → overlay redraw. That fan-out, several times a second, was
  // the page's lag.
  //
  // Trailing-edge 250ms = a 4Hz ceiling on renders. The maps are refs and are
  // still written on every frame, so NO data is dropped — only the render is
  // deferred, and whatever lands in the window is published together.
  const COALESCE_MS = 250;
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which publishes are owed. Accumulated across the coalesce window — see the
  // note at the arm site.
  const pendingRowsRef = useRef(false);
  const pendingTickRef = useRef(false);

  // Monotonic load token. Guards against a STALE fetch landing after a switch:
  // loadFromDb is async, so toggling 1m→5m leaves the 1m request in flight, and
  // its .then() merges into the map the clear-effect just wiped. The two
  // intervals do NOT collide on slotKey (1m has :31/:32/:33, 5m only :30/:35), so
  // nothing overwrites — the stale bars INTERLEAVE, producing a series that is
  // 5m bars with 1m bars wedged between them. It renders happily and is garbage.
  const loadSeqRef = useRef(0);

  // SQLite load (today + history). Reused by mount and manual reload.
  const loadFromDb = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const want = intervalMinutes;
    // allSettled, NOT all. These are two independent reads and a rejection in
    // either one used to take BOTH down: `Promise.all` rejects on the first
    // failure, `loadFromDb` throws, and every caller wraps it in
    // `.catch(() => {})` — so a hiccup on the today request silently left
    // `historical` empty, which is the single input the ES/SPX basis anchor is
    // built from. That failure mode is invisible except as levels drifting ~50pt.
    // Shared across every instance asking for the same (interval, days) — see
    // sharedLoad. The key space is tiny: intervalMinutes is only ever 1 or 5.
    const [todayRes, histRes] = await sharedLoad(
      `${intervalMinutes}|${historyDays}`,
      () => Promise.allSettled([
        queryEsCandlesToday(intervalMinutes),
        // 1m history stays SHORT — dxFeed only serves ~7 days of it, and this
        // array feeds buildSlotAverages, where a 20-day request at 1m would be
        // 5x the rows for baselines that mostly don't exist.
        //
        // It is a CEILING, not a fixed 2. It used to be a hard `? 2 :`, which
        // meant ES Candles could never show more than two sessions of 1-minute
        // bars however far its own window reached — the caller's number was
        // silently discarded. `Math.min` keeps the ceiling and honours anything
        // under it, so a caller asking for 2 still gets exactly 2.
        //
        // 7, because the ceiling is in CALENDAR days and callers want SESSIONS.
        // Five sessions viewed from a Sunday reaches back to the previous
        // Monday — seven calendar days — so a 5 here quietly returned three
        // sessions every weekend.
        queryEsCandlesHistorical(
          intervalMinutes === 1 ? Math.min(historyDays, 7) : historyDays,
          intervalMinutes,
        ),
      ]),
    );
    if (todayRes.status === "rejected") console.warn("[es-candles] today load failed:", todayRes.reason);
    if (histRes.status === "rejected") console.warn("[es-candles] history load failed:", histRes.reason);
    const today = todayRes.status === "fulfilled" ? todayRes.value : [];
    const hist = histRes.status === "fulfilled" ? histRes.value : [];
    if (unmountedRef.current) return;
    // Superseded by a newer load, or the interval moved under us → drop it.
    // Checked against the ref (not the closure) so an in-flight load can't
    // resurrect the aggregation the user just switched away from.
    if (seq !== loadSeqRef.current || want !== intervalRef.current) return;
    if (hist.length) setHistorical(hist);
    if (today.length) {
      // Merge — never wipe live bars already in the map.
      for (const r of today) {
        if (!liveMapRef.current.has(r.slotKey)) liveMapRef.current.set(r.slotKey, r);
        if (!sessionMapRef.current.has(r.slotKey)) sessionMapRef.current.set(r.slotKey, r);
      }
      setTodayRows([...liveMapRef.current.values()]);
      setSessionTick((n) => n + 1);
    }
  }, [historyDays, intervalMinutes]);

  // Switching aggregation MUST wipe the maps first. Both loadFromDb and ingest
  // merge by slotKey and never replace, and 1m/5m share the slotKey space — so
  // without this, flipping 5m→1m leaves every 5m bar sitting in the map and
  // stacks 1m bars beside them, producing one series built from two different
  // aggregations. It renders, and it is nonsense.
  const prevIntervalRef = useRef(intervalMinutes);
  useEffect(() => {
    if (prevIntervalRef.current === intervalMinutes) return;
    prevIntervalRef.current = intervalMinutes;
    liveMapRef.current.clear();
    sessionMapRef.current.clear();
    setTodayRows([]);
    setHistorical([]);
    setSessionTick((n) => n + 1);
  }, [intervalMinutes]);

  // Initial SQLite load — only when enabled (stays idle until turned on).
  // loadFromDb is keyed on intervalMinutes, so a switch re-runs this too.
  useEffect(() => { if (enabled) loadFromDb().catch(() => {}); }, [enabled, loadFromDb]);

  /**
   * Manual refresh — re-pulls from SQLite ONLY when nothing is loaded yet.
   * Never clears existing bars and never resets the IB window; if data is
   * already present this is a no-op so the live range keeps running.
   */
  const refresh = useCallback(async () => {
    if (liveMapRef.current.size > 0) return;
    // Swallow fetch/db errors (e.g. backend down) so callers never see a reject.
    await loadFromDb().catch(() => {});
  }, [loadFromDb]);

  // Live WS merge.
  useEffect(() => {
    unmountedRef.current = false;
    const today = todayETStr();

    const ingest = (rows: unknown) => {
      if (!Array.isArray(rows)) return;
      let changed = false;
      let sessionChanged = false;
      for (const raw of rows as EsCandleRecord[]) {
        if (!raw || !raw.slotKey) continue;
        // Rolling-session map keeps every live bar (incl. overnight, any date).
        sessionMapRef.current.set(raw.slotKey, raw);
        sessionChanged = true;
        // Today set is today-only (feeds `candles` for IB / RelVol).
        if (dateOf(raw) !== today) continue;
        liveMapRef.current.set(raw.slotKey, raw);
        changed = true;
      }
      // Coalesced publish (see COALESCE_MS above). The `if (!timer)` guard makes
      // this trailing-edge: the first frame in a quiet period arms the timer and
      // every frame for the next 250ms rides it, then one render carries them all.
      // ONE timer for both publishes.
      //
      // These were two independent setTimeouts, and a live frame almost always
      // sets both `changed` and `sessionChanged` — so they armed together, fired
      // as two separate macrotasks, and React batched neither against the other.
      // The documented 4Hz ceiling was really 8 renders/sec of the consuming
      // page, which on /es-candles is a 5,000-line component whose biggest
      // effect has `rows` in its dep array.
      //
      // The two flags ACCUMULATE across the window rather than being captured
      // when the timer is armed. A batch can be session-only (bars not dated
      // today), and if that batch armed the timer, a today-dated batch arriving
      // 50ms later would otherwise ride a callback that had already decided not
      // to publish `todayRows` — leaving it stale until the next frame that
      // happened to arm a fresh timer.
      if (changed) pendingRowsRef.current = true;
      if (sessionChanged) pendingTickRef.current = true;
      if ((changed || sessionChanged) && !publishTimerRef.current) {
        publishTimerRef.current = setTimeout(() => {
          publishTimerRef.current = null;
          if (unmountedRef.current) return;
          const wantRows = pendingRowsRef.current;
          const wantTick = pendingTickRef.current;
          pendingRowsRef.current = false;
          pendingTickRef.current = false;
          // Both setStates in one callback → one React batch → one render.
          if (wantRows) setTodayRows([...liveMapRef.current.values()]);
          if (wantTick) setSessionTick((n) => n + 1);
        }, COALESCE_MS);
      }
    };

    // Frames arrive pre-parsed from the shared socket (lib/gexSocket parses each
    // frame ONCE for all consumers instead of once per connection).
    const handle = (msg: GexMessage) => {
      const type = String(msg.type ?? "");
      const data = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      // Take ONLY the stream matching this hook's aggregation. The server sends
      // both 'esCandles' (5m) and 'es1mCandles' (1m) on the same socket, and they
      // share a slotKey space — ingesting both would merge two aggregations into
      // one series. `wantType` is read from a ref so a switch takes effect without
      // tearing down and reconnecting the socket.
      const want = intervalRef.current === 1 ? "es1mCandles" : "esCandles";
      if (type === "snapshot") ingest(intervalRef.current === 1 ? data.es1mCandles : data.esCandles);
      else if (type === want) ingest(Array.isArray(data) ? data : data[want]);
      // Rare server-push notices (daily/forced regime refits) — re-dispatched
      // as window events so any mounted card (e.g. the Regime Engine tab's
      // Persistent Learning card) can refetch without owning its own socket.
      else if (type === "regime-fit-updated" || type === "pairs-regime-updated") {
        try { window.dispatchEvent(new CustomEvent(type, { detail: data })); } catch { /* noop */ }
      }
    };

    // Value-driven bandwidth gate: re-runs when shouldConnect flips. Subscribe
    // when allowed; the cleanup unsubscribes when not (no polling). Connection
    // ownership, reconnect and backoff now live in lib/gexSocket — this hook
    // shares ONE socket with the toolbar ticker and the ES-candles page instead
    // of opening a third connection to the same broadcast.
    unmountedRef.current = false;
    let unsubscribe: (() => void) | null = null;
    if (shouldConnect) {
      unsubscribe = subscribeGex({
        topics: ES_CANDLE_TOPICS,
        onMessage: (msg) => { if (!unmountedRef.current) handle(msg); },
        onStatus: (live) => { if (!unmountedRef.current) setConnected(live); },
      });
    }

    return () => {
      unmountedRef.current = true;
      // Pending coalesced publishes must not fire into an unmounted tree.
      if (publishTimerRef.current) { clearTimeout(publishTimerRef.current); publishTimerRef.current = null; }
      pendingRowsRef.current = false;
      pendingTickRef.current = false;
      unsubscribe?.();
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldConnect]);

  // Enrich today's bars with 5/14-day slot averages.
  //
  // OPT-IN (`withAverages`). This was unconditional, and it is expensive: TWO
  // full buildSlotAverages passes over the entire historical array, plus a sort
  // and a map, re-run every time `todayRows` is republished — i.e. 4x/sec while
  // the tape is live. /es-candles, which mounts up to three of these hooks,
  // destructures { sessionCandles, historical, connected, refresh } and has
  // never read `candles` at all, so on that page 100% of that work was thrown
  // away. The RelVol / IB consumers that DO want it pass withAverages.
  const candles = useMemo<EsCandle[]>(() => {
    if (!withAverages) return EMPTY_CANDLES;
    const today = todayETStr();
    const avg5 = buildSlotAverages(historical, today, 5);
    const avg14 = buildSlotAverages(historical, today, 14);
    return [...todayRows]
      .sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey))
      .map((c) => {
        const slot = slotTimeOf(c);
        return { ...c, avg5: avg5.get(slot) ?? 0, avg14: avg14.get(slot) ?? 0 };
      });
  }, [withAverages, todayRows, historical]);

  // Rolling continuous-session view: ~30h of bars regardless of ET date, so the
  // overnight (prior-day-dated) session is included and the chart follows into a
  // new day. Merge DB history with the live session map; live wins on slotKey.
  //
  // The window is anchored to the NEWEST bar we actually hold, not to
  // `Date.now()`. Anchoring it to wall-clock time meant the window slid off the
  // end of the tape whenever the market had been shut for longer than the
  // window — and 30h is shorter than a weekend. At 03:52 ET on a Sunday the
  // newest ES bar is Friday 16:55 ET, 35 hours old, so EVERY bar fell outside
  // `now - 30h` and this returned an empty array with a full, healthy 204-row
  // response sitting in `historical`. The phone chart then rendered its empty
  // state, which blames the live feed, and the page looked like a broken
  // socket every weekend and every holiday. (Only the phone build reads
  // `sessionCandles`, which is why the desktop page never showed it.)
  //
  // Anchoring to the newest bar is a no-op while the tape is live — the newest
  // bar IS ~now — and shows the last session that exists when it is not.
  const sessionCandles = useMemo<EsCandleRecord[]>(() => {
    void sessionTick; // re-run when live session bars arrive
    const WINDOW_MS = 30 * 60 * 60 * 1000;
    let newest = 0;
    for (const c of historical) if (c.timestamp > newest) newest = c.timestamp;
    for (const c of sessionMapRef.current.values()) if (c.timestamp > newest) newest = c.timestamp;
    // No bars at all → nothing to window; keep the old wall-clock behaviour.
    const cutoff = (newest || Date.now()) - WINDOW_MS;
    const map = new Map<string, EsCandleRecord>();
    for (const c of historical) if (c.slotKey && c.timestamp >= cutoff) map.set(c.slotKey, c);
    for (const c of sessionMapRef.current.values()) if (c.timestamp >= cutoff) map.set(c.slotKey, c);
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey));
  }, [historical, sessionTick]);

  // Toolbar refresh. `loadFromDb`, NOT `refresh`: the exported `refresh` is a
  // no-op once live bars exist (by design — it exists to fill an EMPTY chart
  // without disturbing a running one), and "nothing happened" is the one
  // outcome a refresh button must not have. loadFromDb merges by slotKey and
  // never wipes, so re-pulling over a live map is safe, and its seq token
  // drops a press that lands after an interval switch.
  useRefreshSource(() => loadFromDb().catch(() => {}), "useEsCandles");

  return { candles, sessionCandles, historical, connected, refresh };
}
