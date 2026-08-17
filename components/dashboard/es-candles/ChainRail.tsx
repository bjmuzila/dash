"use client";

/**
 * 0DTE option chain, painted as a price-aligned ladder beside the candle chart.
 *
 * ── Why this isn't the /options-chain grid ──────────────────────────────────
 * The obvious move was to embed app/options-chain/page.tsx with one column, and
 * that is what this started as. It can't satisfy the one requirement that
 * matters here: every strike row has to sit at the SAME y as that price on the
 * chart. The chain grid is a CSS grid with fixed row heights inside its own
 * scroll container — its rows are evenly spaced in the grid's coordinate space,
 * not in the chart's, so the two ladders drift apart the moment you zoom, pan,
 * or the strike spacing isn't uniform (SPX lists 5-point strikes with 1-point
 * infill near the money intraday).
 *
 * So the LAYOUT is new and the DATA is not. `parseExpiration` and `metricBg`
 * moved out of that page into lib/calculations/optionChain.ts and are imported
 * here, so the GEX/DEX/VEX/CHEX formulas and the heat ramp are literally the
 * same code the /options-chain route runs. A strike that reads +$412M and
 * full-strength cyan there reads the same here.
 *
 * Canvas, not DOM, for the same reason EsGexRail is: this repaints on every pan
 * and zoom frame through `drawRef`, and re-laying-out a hundred absolutely
 * positioned rows at 60fps is exactly the jank the rail was built to avoid.
 */

import { memo, useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { atMinIntensity, columnWalls, wallAt, INTENSITY_MIN, WALL_RANK } from "@/lib/calculations/heatLevels";
import { dedupeFetch } from "@/lib/dedupeFetch";
import { cachedJson } from "@/lib/sharedCache";
import { parseExpiration, metricBg, rankBg, type GreekCell } from "@/lib/calculations/optionChain";

/** Greeks this panel can show. "oi" is deliberately absent — the chain page's OI
 *  tab reads a day-over-day snapshot, not the live chain, so it has no meaning
 *  in a panel that only ever holds one live expiry. */
export const CHAIN_GREEKS = ["gex", "dex", "vex", "chex"] as const;
export type ChainGreek = (typeof CHAIN_GREEKS)[number];
export const isChainGreek = (v: unknown): v is ChainGreek =>
  typeof v === "string" && (CHAIN_GREEKS as readonly string[]).includes(v);
/** Labels for the page toolbar's switcher — this component only paints. */
export const GREEK_LABEL: Record<ChainGreek, string> = { gex: "GEX", dex: "DEX", vex: "VEX", chex: "CHEX" };

const CHAIN_REFRESH_MS = 60_000;
const EXPIRY_REFRESH_MS = 30 * 60_000;

/** ET calendar date (YYYY-MM-DD). */
const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etDayKey = (ts: number) => ET_DAY.format(new Date(ts));

/** Millions, whole — the chain page's own convention for these cells. */
function fmtM(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "·";
  const m = v / 1e6;
  const abs = Math.abs(m);
  const s = m < 0 ? "-" : "";
  if (abs >= 1000) return `${s}${(abs / 1000).toFixed(1)}B`;
  if (abs >= 1) return `${s}${Math.round(abs)}M`;
  return `${s}${abs.toFixed(1)}M`;
}

interface ChainRailProps {
  /** Chain ticker — SPX for ES, else the ETF itself. NOT gexSymbol ("$SPX"). */
  symbol: string;
  /**
   * ES − SPX. Chain strikes are in index space and the chart plots ES, so every
   * row is placed at priceToY(strike + basis). Zero on SPY/QQQ, where the
   * strikes are already the chart's own prices and the offset is an identity.
   */
  basis: number;
  /** Maps a CHART price to a y pixel on the candle pane. Same fn the rail uses. */
  priceToY: (price: number) => number | null;
  /** Assigned this panel's imperative repaint so the card can drive it. */
  drawRef?: MutableRefObject<() => void>;
  /** Shares the card's heatmap intensity slider so the two read as one scale. */
  intensity: number;
  /**
   * Which greek to paint. Owned by the PAGE toolbar, not by this component:
   * the side panel is a page-level choice, and three ladders showing three
   * different greeks would be silently incomparable.
   *
   * It is also why the switcher can't live in here — see the note about height
   * below.
   */
  greek: ChainGreek;
  /**
   * Replay override. When non-null this panel paints the supplied ladder INSTEAD
   * of its live poll, so the 0DTE column scrubs with the cursor like the GEX
   * rail already did.
   *
   * `rows` are (strike, value) in the same units as the live cells — the
   * recorder's netGEX and the chain's gexValue are the same formula, so `fmtM`
   * labels both identically. See the note where the card builds this.
   *
   * `unavailable` is the honest half. option_strike_gex_history stores gamma
   * exposure and nothing else, so DEX / VEX / CHEX have no past to replay to.
   * Rather than freeze a live ladder under a replay cursor — which looks like
   * data and isn't — the panel says so and draws nothing.
   */
  replay?: { rows: Array<{ strike: number; v: number }>; unavailable: boolean } | null;
}

function ChainRail({
  symbol, basis, priceToY, drawRef, intensity, greek, replay = null,
}: ChainRailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [expiry, setExpiry] = useState("");
  const [status, setStatus] = useState<"loading" | "ok" | "empty" | "error">("loading");
  // Chain data lives in a ref, not state: the draw is imperative and runs on
  // every pan frame. Putting a 200-entry Map in state would re-render the tree
  // on each 60s poll for a canvas that repaints itself anyway.
  const cellsRef = useRef<Map<number, GreekCell>>(new Map());
  const spotRef = useRef(0);
  const [dataVersion, setDataVersion] = useState(0);

  // Mirrored so the imperative draw reads current values without re-binding.
  const basisRef = useRef(basis); basisRef.current = basis;
  const greekRef = useRef(greek); greekRef.current = greek;
  const intensityRef = useRef(intensity); intensityRef.current = intensity;
  const priceToYRef = useRef(priceToY); priceToYRef.current = priceToY;
  const replayRef = useRef(replay); replayRef.current = replay;

  // ── Resolve the 0DTE expiry ────────────────────────────────────────────────
  // "Today ET", snapped FORWARD to the nearest real listing: plenty of tickers
  // have no same-day expiry, and a market holiday removes even SPX's. The
  // nearest thing that actually trades is the honest answer to "0DTE".
  //
  // Re-resolved on an interval as well as on symbol change, so a dashboard left
  // open overnight rolls to the new session's expiry instead of pinning to
  // yesterday's, which would quietly show a dead chain.
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const resolve = async () => {
      try {
        // cachedJson, not dedupeFetch: the expiry LIST is a once-a-day fact, so
        // there is no reason for card 2's 30-minute tick to open a socket just
        // because it landed a few ms after card 1's. Persisted, so a reload
        // resolves the chain's expiry without a round trip. 15 min = half the
        // refresh interval, so a real tick always crosses the TTL.
        const j = await cachedJson<{ data?: { items?: Array<Record<string, unknown>> } } | null>(
          `/api/expirations?ticker=${encodeURIComponent(symbol)}`,
          { ttlMs: EXPIRY_REFRESH_MS / 2, persist: true },
        ).catch(() => null);
        if (cancelled) return;
        const items: Array<Record<string, unknown>> = j?.data?.items ?? [];
        const today = etDayKey(Date.now());
        const dates = [...new Set(items.map((it) => String(it["expiration-date"] ?? "")).filter(Boolean))].sort();
        const pick = dates.find((d) => d >= today) ?? "";
        setExpiry(pick || today);
      } catch {
        if (!cancelled) setExpiry(etDayKey(Date.now()));
      }
    };
    resolve();
    const id = setInterval(resolve, EXPIRY_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol]);

  // ── Chain poll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!symbol || !expiry) return;
    let cancelled = false;
    const load = async () => {
      try {
        // dedupeFetch: three cards showing the same symbol ask for byte-identical
        // URLs at the same moment. One request, three readers.
        const res = await dedupeFetch(
          `/api/chains?ticker=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiry)}&range=all`,
        );
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        const data = (json?.data as Record<string, unknown> | undefined) ?? undefined;
        const items = (data?.items as unknown[]) ?? [];
        const underlying = parseFloat(String(data?.underlyingPrice ?? 0)) || 0;
        const cells = parseExpiration(items, expiry, underlying, "oi-vol");
        cellsRef.current = cells;
        spotRef.current = underlying;
        setStatus(cells.size ? "ok" : "empty");
        setDataVersion((v) => v + 1);
      } catch {
        // Keep the last good chain rather than blanking the panel on one blip.
        if (!cancelled && cellsRef.current.size === 0) setStatus("error");
      }
    };
    load();
    const id = setInterval(load, CHAIN_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol, expiry]);

  // ── Draw ───────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const rp = replayRef.current;
    const cells = cellsRef.current;
    // Replay with no history for this greek: paint nothing but the notice. An
    // empty panel is the correct answer; a frozen live ladder under a moving
    // cursor is a wrong one that looks right.
    if (rp?.unavailable) return;
    if (!rp && !cells.size) return;
    const b = basisRef.current;
    const g = greekRef.current;
    const toY = priceToYRef.current;

    // Strikes ascending, each with its chart y. This is the whole point of the
    // component: y comes from the CHART's price scale, so a row can only ever be
    // where that price is. Nothing here assumes uniform strike spacing, which is
    // what a fixed-row-height grid cannot avoid assuming.
    const rows: Array<{ strike: number; y: number; v: number }> = [];
    const src: Array<[number, number]> = rp
      ? rp.rows.map((r) => [r.strike, r.v] as [number, number])
      : [...cells].map(([strike, cell]) => [strike, Number(cell[g]) || 0] as [number, number]);
    for (const [strike, v] of src) {
      const y = toY(strike + b);
      if (y == null || !Number.isFinite(y)) continue;
      // Cull generously rather than exactly: a row whose centre is just off the
      // pane can still own a visible band.
      if (y < -40 || y > h + 40) continue;
      rows.push({ strike, y, v });
    }
    if (!rows.length) return;
    rows.sort((r1, r2) => r1.strike - r2.strike);

    // Heat scale over the VISIBLE rows only, matching how the chain page scales
    // per column: an off-screen monster wall shouldn't wash out everything you
    // are actually looking at.
    // Single pass for max + top-3 instead of map + filter + spread + sort. The
    // spread in particular pushed one argument per visible strike onto the stack
    // on every rail draw, i.e. every overlay frame.
    let max = 0, t1 = 0, t2 = 0, t3 = 0;
    for (let i = 0; i < rows.length; i++) {
      const a = Math.abs(rows[i].v);
      if (!(a > 0)) continue;
      if (a > max) max = a;
      if (a > t1) { t3 = t2; t2 = t1; t1 = a; }
      else if (a > t2) { t3 = t2; t2 = a; }
      else if (a > t3) { t3 = a; }
    }
    if (max === 0) max = 1;
    const top3: number[] = [];
    if (t1 > 0) top3.push(t1);
    if (t2 > 0) top3.push(t2);
    if (t3 > 0) top3.push(t3);

    // Row bands: halfway to each neighbour, so the ladder tiles with no gaps and
    // no overlap however irregular the strike spacing is. y DECREASES as strike
    // increases (price up = screen up), so min/max rather than assuming an
    // order — a log price scale would flip the sign of the spacing, not the
    // rule.
    const bandFor = (i: number): { top: number; bot: number } => {
      const y = rows[i].y;
      const above = i + 1 < rows.length ? (y + rows[i + 1].y) / 2 : y - 6;
      const below = i > 0 ? (y + rows[i - 1].y) / 2 : y + 6;
      return { top: Math.min(above, below), bot: Math.max(above, below) };
    };

    // The chain page's metricBg curve clamps intensity at 1 and useful values
    // run to ~3 (its own slider defaults to 1.75). The card's heatmap slider is
    // 0.1–1, so map it onto that range instead of passing it through — raw, it
    // would clamp to the floor at every position and the slider would appear
    // dead over this panel.
    const heat = 1 + intensityRef.current * 2;

    // Levels-only: the card's slider at its bottom stop (0.1) switches the heat
    // field off on the chart, and the rail has to follow or the two panels stop
    // describing the same thing. Ranked over the SAME visible rows the heat
    // scale uses, so the rail's CB/CW/PW are the ladder you can actually see.
    const levelsOnly = atMinIntensity(intensityRef.current, INTENSITY_MIN.esCandles);
    const walls = levelsOnly ? columnWalls(rows.map((r) => ({ strike: r.strike, net: r.v }))) : null;

    // Strike + value needs ~105px. Below that the value alone wins — see the
    // note at the label draw for why losing the strike costs nothing.
    const showStrikes = w >= 105;

    ctx.textBaseline = "middle";
    // Labels are collected here and drawn in two passes AFTER the bands.
    //
    // They used to be drawn inline, which meant `ctx.font` was assigned twice
    // and `ctx.textAlign` flipped twice for every row — ~200 rows, so ~400
    // font-string parses per rail draw, and the rail draws on every overlay
    // frame. Assigning ctx.font is a CSS font-shorthand parse; it is not free.
    // Batching by style makes it two assignments total.
    const labels: Array<{ mid: number; strike: number; v: number }> = [];
    for (let i = 0; i < rows.length; i++) {
      const { strike, v } = rows[i];
      const { top, bot } = bandFor(i);
      const bandH = Math.max(1, bot - top);

      const wk = levelsOnly ? wallAt(walls, strike) : null;
      const bg = levelsOnly
        ? (wk && v ? rankBg(v, WALL_RANK[wk]) : "transparent")
        : metricBg(v, max, heat, top3);
      if (bg !== "transparent") {
        ctx.fillStyle = bg;
        ctx.fillRect(0, top, w, bandH);
      }

      // Labels only when the band can hold them. At a zoomed-out view the rows
      // are 2px tall and text would just be a smear — the heat still reads.
      //
      // The strike itself is dropped on a narrow panel, and that costs nothing:
      // the rows are aligned to the chart, and the chart's own price axis sits
      // immediately to the left of this panel already labelling those prices.
      // Printing them twice was only ever necessary when the ladder was free to
      // drift out of register.
      if (bandH >= 9) labels.push({ mid: (top + bot) / 2, strike, v });
    }

    if (labels.length) {
      // Pass 1: the strike column (left-aligned, lighter weight).
      if (showStrikes) {
        ctx.font = "600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.textAlign = "left";
        for (const l of labels) ctx.fillText(String(l.strike), 4, l.mid);
      }
      // Pass 2: the value column (right-aligned, bold). fillStyle still flips
      // per row for the zero case, but that is a cheap colour swap, not a parse.
      ctx.font = `700 ${showStrikes ? 9.5 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "right";
      let curFill = "";
      for (const l of labels) {
        const fill = l.v === 0 ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.92)";
        if (fill !== curFill) { ctx.fillStyle = fill; curFill = fill; }
        ctx.fillText(fmtM(l.v), w - 3, l.mid);
      }
    }

    // Spot marker — the chain's own underlying, converted to chart space, so you
    // can see where the money is on this ladder without cross-referencing.
    // Suppressed in replay: spotRef holds the LIVE underlying, and a live spot
    // line across a replayed ladder is the one thing on this panel that would
    // still be telling you about now.
    const spotY = !rp && spotRef.current > 0 ? toY(spotRef.current + b) : null;
    if (spotY != null && spotY >= 0 && spotY <= h) {
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(spotY) + 0.5);
      ctx.lineTo(w, Math.round(spotY) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, []);

  // Publish the imperative repaint. The card's rAF loop already calls this on
  // every visible-range change, which is what keeps the ladder locked to the
  // chart through a pan or a zoom.
  useEffect(() => {
    if (drawRef) drawRef.current = draw;
    return () => { if (drawRef) drawRef.current = () => {}; };
  }, [draw, drawRef]);

  // Repaint on our own data / control changes too — the card's loop is a
  // backstop, not the only trigger.
  useEffect(() => { draw(); }, [draw, dataVersion, greek, intensity, basis, replay]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  // ── Geometry contract ──────────────────────────────────────────────────────
  // This box must be EXACTLY the chart container's box. `priceToY` answers in
  // coordinates relative to the candle pane, whose origin is the top of that
  // container, so any chrome in the flow above this canvas shifts every row
  // down by its height and the ladder silently stops matching the chart.
  //
  // That is not hypothetical — it is the bug this component shipped with: a
  // two-line header (expiry + greek chips) pushed the whole ladder ~26px low,
  // which reads as "the strikes are a bit off". Nothing goes above the canvas.
  // The greek switcher moved to the page toolbar, and the expiry is painted
  // INSIDE the canvas as an overlay label that owns no layout.
  //
  // EsGexRail obeys the same contract, which is why the rail has always lined up.
  return (
    <div ref={wrapRef} style={{ position: "relative", height: "100%", width: "100%", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0 }} />
      {/* Absolutely positioned — takes no space, so it cannot move the ladder. */}
      <div style={{
        position: "absolute", top: 2, left: 0, right: 0, textAlign: "center",
        fontSize: 8.5, fontWeight: 800, letterSpacing: ".04em", color: HOME_THEME.muted,
        pointerEvents: "none", whiteSpace: "nowrap", overflow: "hidden",
        textShadow: "0 1px 3px rgba(0,0,0,0.9)",
      }}>
        {/* In replay the live expiry label would be a lie about which session
            you are looking at — the transport above already names the day. */}
        {replay ? "REPLAY" : expiry ? `${expiry.slice(5)}${expiry === etDayKey(Date.now()) ? " 0DTE" : ""}` : "…"}
      </div>
      {replay?.unavailable ? (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 6, textAlign: "center", fontSize: 9.5, color: HOME_THEME.muted }}>
          {GREEK_LABEL[greek]} has no recorded history — switch to GEX to replay this panel.
        </div>
      ) : !replay && status !== "ok" ? (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 6, textAlign: "center", fontSize: 9.5, color: HOME_THEME.muted }}>
          {status === "loading" ? "Loading chain…"
            : status === "empty" ? `No ${expiry} chain for ${symbol}`
            : "Chain unavailable"}
        </div>
      ) : null}
    </div>
  );
}

/**
 * memo().
 *
 * The rail is a canvas that repaints itself imperatively through `drawRef`, so a
 * React re-render of it accomplishes nothing but reconciliation work — and it was
 * getting one for every parent render, i.e. formerly every mouse move.
 */
export default memo(ChainRail);
