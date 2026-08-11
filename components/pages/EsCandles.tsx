"use client";

/**
 * /es-candles — a row of 1 to 3 candle charts under ONE toolbar.
 *
 * A single chart lives in components/dashboard/es-candles/EsChartCard.tsx; this
 * file is the workspace around it: how many charts, what rides their right
 * edge, what's drawn on all of them, and where the controls go.
 *
 * ── The CANDLES toolbar ─────────────────────────────────────────────────────
 * One bar across the top. It holds almost nothing itself — a title and three
 * buttons — because everything it used to hold at once (chart count, panel
 * choice, greek picker, and, per card, a whole replay transport) added up to
 * more chrome than chart.
 *
 * Each button opens a POPOVER: a panel that hovers below the bar, over the
 * charts, and closes when you press the button again. Hovering rather than
 * pushing the row down matters — a panel that reflows the layout resizes every
 * chart underneath it, and lightweight-charts rebuilds its whole time scale on
 * a resize, so opening a menu would make three charts flicker.
 *
 * ── One chart vs several ────────────────────────────────────────────────────
 * At ONE chart the card owns its own dock (symbol, timeframe, overlays).
 *
 * At two or three, three copies of a 1,200px toolbar is most of the screen, so
 * the row switches to a SHARED dock: one, hoisted up here, driving every chart
 * at once. The only per-chart control left is the ticker — which is the point
 * of the layout. ES / SPY / QQQ side by side on one timeframe with one set of
 * overlays is a comparison; three charts each with their own everything is
 * three pages in a trenchcoat.
 *
 * Mechanically the shared dock is still card 0's dock, portaled into the target
 * below (see EsChartCard's `dockMode`). It stays wired to card 0's live feed
 * state — the expirations list, the replay frames, the connection status — and
 * its writes broadcast to the other cards through slotStore. Lifting those
 * controls into this file would mean this file owning the websocket.
 *
 * Replay is the one control that ISN'T card 0's dock: the button lives up here,
 * and the transport it opens is portaled into the popover. The card still owns
 * replay STATE (only it knows how many bars the session has); this file only
 * says on or off, over slotStore's replay command channel.
 *
 * The home dashboard still imports THIS file (app/home/HomeClient.tsx renders
 * `<EsCandlesPage embedded leading={gexViewSwitch} />`), so the `{ leading,
 * embedded }` signature is load-bearing. In that mode the page collapses to a
 * single card and renders no chrome of its own.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import EsChartCard from "@/components/dashboard/es-candles/EsChartCard";
import {
  MAX_CARDS, SHARED_SLOT, ensureMigrated,
  readCardCount, writeCardCount, readSidePanel, writeSidePanel,
  readChainGreek, writeChainGreek,
  readIndicators, writeIndicators, broadcastReplayCmd,
  INDICATORS_DEFAULT, MAX_EMAS,
  type SidePanelKind, type IndicatorCfg,
} from "@/components/dashboard/es-candles/slotStore";
import { EMA_COLORS } from "@/components/dashboard/es-candles/indicators";
import { CHAIN_GREEKS, GREEK_LABEL, isChainGreek, type ChainGreek } from "@/components/dashboard/es-candles/ChainRail";
import { DockButton, SegGroup } from "@/components/shared/DockToolbar";
import { Card } from "@/components/shared/PageCard";
import LayoutPresetButton from "@/components/dashboard/es-candles/LayoutPresetButton";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";

const PANEL_OPTIONS: Array<{ label: string; value: SidePanelKind }> = [
  { label: "None", value: "none" },
  { label: "Rail", value: "rail" },
  { label: "0DTE", value: "chain" },
];

/** Which popover is open. Exactly one at a time — two hovering panels would overlap. */
type Popover = "charts" | "replay" | "indicators" | null;

// ── Popover metrics ──────────────────────────────────────────────────────────
// Every control in the menu is laid out against these three numbers so the boxes
// land on ONE line across all four groups.
//
// The first pass let each group size itself, and the result was a staircase: a
// captioned field is taller than a bare toggle, so "Cloud" sat 16px above the
// LEN box beside it, and the whole STUDY group rode higher than BOLLINGER
// because only one of them had a caption. Two rules fix it and neither can be
// fudged per-group — a fixed row height, and bottom alignment inside the row, so
// captions grow UPWARD into space the row already reserved instead of pushing
// their input down past its neighbours.
const CTRL_H = 30;   // every toggle and input
const CAP_H = 13;    // the caption line above an input
const CAP_GAP = 3;
const ROW_H = CAP_H + CAP_GAP + CTRL_H;

/**
 * A labelled group inside a popover. Popovers are dense by nature, so the label
 * is small, uppercase and quiet, and the controls sit right under it.
 *
 * The row is a FIXED height and bottom-aligned — see the note above. A group
 * with no captioned fields still reserves the caption line, which is what keeps
 * EMA's toggles level with BOLLINGER's inputs.
 */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase",
        color: HOME_THEME.muted, whiteSpace: "nowrap",
        // Explicit line box: the group labels are the top edge every column is
        // measured from, and an inherited line-height differs by font stack.
        height: 12, lineHeight: "12px",
      }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, minHeight: ROW_H }}>
        {children}
      </div>
    </div>
  );
}

/** Small numeric field. Bare `type=number` inherits the page font and looks foreign. */
function NumField({
  value, onChange, min, max, step = 1, width = 58, title,
}: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; width?: number; title?: string }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      title={title}
      // Commit on change, but CLAMP on blur rather than per keystroke: clamping
      // as you type makes "2" impossible to reach on the way to "20" when the
      // minimum is 5 — the field fights the person using it.
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      onBlur={(e) => {
        const v = Number(e.target.value);
        onChange(Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);
      }}
      style={{
        width,
        height: CTRL_H,
        // border-box, or the 1px border makes these 32px tall while a control
        // that sets box-sizing elsewhere stays 30 — a 2px stagger that is
        // invisible in isolation and obvious in a row of eight.
        boxSizing: "border-box",
        padding: "0 8px",
        borderRadius: 8,
        border: `1px solid ${HOME_THEME.border}`,
        background: "rgba(255,255,255,0.04)",
        color: HOME_THEME.text,
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
      }}
    />
  );
}

/**
 * Caption over a bare input. Three unlabelled number boxes in a row ("20", "2.3",
 * "3") are three anonymous numbers; a two-word caption is the difference between
 * reading the menu and guessing at it.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: CAP_GAP }}>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase",
        color: HOME_THEME.muted, opacity: 0.75, paddingLeft: 2,
        // Fixed, so caption + gap + control is exactly ROW_H and the box below
        // lands on the same baseline as every uncaptioned control in the row.
        height: CAP_H, lineHeight: `${CAP_H}px`, whiteSpace: "nowrap",
      }}>
        {label}
      </span>
      {children}
    </span>
  );
}

/**
 * On/off control with an explicit CHECKBOX.
 *
 * The first cut was a pill that went from muted to blue. That is a fine state
 * indicator once you already know it is a toggle, and useless before — with
 * every indicator off, a row of dim pills reads as a row of buttons you press to
 * do something, and there is nothing on screen to compare an "on" one against.
 * A box that is either ticked or empty says which it is with nothing to compare
 * to, which is the whole job.
 *
 * `swatch` draws the line's own colour next to the label, so with three EMAs
 * running you can tell which row is which line without turning them off one at
 * a time to find out.
 */
function Toggle({
  on, onClick, children, title, swatch,
}: { on: boolean; onClick: () => void; children: ReactNode; title?: string; swatch?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      style={{
        height: CTRL_H,
        boxSizing: "border-box",
        padding: "0 10px 0 7px",
        borderRadius: 8,
        border: `1px solid ${on ? LIGHT_BLUE : HOME_THEME.border}`,
        background: on ? "rgba(41,182,246,0.16)" : "rgba(255,255,255,0.03)",
        color: on ? HOME_THEME.text : HOME_THEME.muted,
        fontSize: 12,
        fontWeight: 800,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14, height: 14, borderRadius: 4, flexShrink: 0,
          border: `1.5px solid ${on ? LIGHT_BLUE : "rgba(255,255,255,0.28)"}`,
          background: on ? LIGHT_BLUE : "transparent",
          color: "#001018",
          fontSize: 10,
          lineHeight: "11px",
          fontWeight: 900,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {on ? "\u2713" : ""}
      </span>
      {swatch && (
        <span aria-hidden style={{ width: 14, height: 3, borderRadius: 2, background: swatch, flexShrink: 0, opacity: on ? 1 : 0.45 }} />
      )}
      {children}
    </button>
  );
}

/**
 * One column of the chart row.
 *
 * At ONE chart the column is a bare flex box: the chart's own dissolve surface
 * is the only edge on screen, and a frame around the whole viewport would just
 * be a box drawn around a box.
 *
 * At two or three it becomes a Card - the same `variant="budget"` panel Multi
 * Greek gives each ticker, at the same 16px radius, so the two multi-panel
 * pages read as one product. Without it three charts share one unbroken dark
 * field and the row reads as a single very wide chart with gaps in it; the
 * card's hairline edge is what says where ES stops and SPY starts.
 *
 * padding={0} because the chart card brings its own gutter (and tightens it in
 * this mode - see `asCardHeader` in EsChartCard); a second layer here would eat
 * ~48px of chart width per column at exactly the sizes where width is
 * scarcest.
 */
function CardSlot({ carded, children }: { carded: boolean; children: ReactNode }) {
  if (!carded) {
    return <div className="flex flex-1 flex-col" style={{ minWidth: 0, minHeight: 0 }}>{children}</div>;
  }
  return (
    <Card
      variant="budget"
      padding={0}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        // The chart surface has its own radius; without this its corners paint
        // over the card's.
        overflow: "hidden",
        borderRadius: 16,
      }}
    >
      {children}
    </Card>
  );
}

export default function EsCandlesPage({ leading, embedded = false }: { leading?: ReactNode; embedded?: boolean } = {}) {
  // Page-level choices. Read in an effect, never in a useState initializer:
  // this route is still server-rendered by Next before the Vite SPA takes over,
  // and a localStorage read during the first render is a hydration mismatch.
  // The first paint is therefore always 1 card / rail / no indicators, which is
  // also the sensible default for a new user.
  const [cards, setCards] = useState(1);
  const [sidePanel, setSidePanelState] = useState<SidePanelKind>("rail");
  const [chainGreek, setChainGreekState] = useState<ChainGreek>("gex");
  const [indicators, setIndicatorsState] = useState<IndicatorCfg>(INDICATORS_DEFAULT);
  const [popover, setPopover] = useState<Popover>(null);
  // The shared dock's mount point. State, not a ref: card 0 renders into it via
  // a portal, and a ref wouldn't re-render the tree once the node exists.
  const [dockTarget, setDockTarget] = useState<HTMLDivElement | null>(null);
  // Where card 0 portals the replay transport. Lives inside the Replay popover.
  const [transportTarget, setTransportTarget] = useState<HTMLDivElement | null>(null);
  // The button row lives inside the CARD's dock (injected as `toolbarExtras`),
  // which on a multi-chart row is itself portaled into this page. So the popover
  // can't be positioned relative to anything in this file's own layout — it is
  // measured off the buttons and drawn `fixed`. A ref works across the portal.
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorBottom, setAnchorBottom] = useState(0);
  // Is replay RUNNING, as distinct from "is its panel open". They come apart the
  // moment you open Indicators while a replay is going, and conflating them made
  // that round trip restart the replay from the open.
  const replayActiveRef = useRef(false);

  useEffect(() => {
    // Folds the pre-multi-card keys into slot blobs. Idempotent; no-ops once
    // slot 0 exists. (readSlot also calls it — React flushes child effects
    // before parent effects, so this one can't be relied on to run first.)
    ensureMigrated();
    setCards(readCardCount());
    setSidePanelState(readSidePanel());
    setIndicatorsState(readIndicators());
    const g = readChainGreek();
    if (isChainGreek(g)) setChainGreekState(g);
  }, []);

  // Close a popover on Escape. Not on outside-click: the panels hover OVER the
  // charts, and the charts are the thing you reach for next — click-away would
  // shut the indicator menu the instant you tried to scrub the chart to see
  // what the indicator you just enabled actually did.
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPopover(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover]);

  // Keep the panel under its buttons. Measured on open and on resize/scroll —
  // the dock's height changes with the FitScale factor and with the compact
  // breakpoint, so a hardcoded offset would drift the moment the window moved.
  useEffect(() => {
    if (!popover) return;
    const measure = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (r) setAnchorBottom(r.bottom);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [popover, cards]);

  const setCardCount = useCallback((n: number) => {
    const clamped = Math.min(MAX_CARDS, Math.max(1, n));
    setCards(clamped);
    writeCardCount(clamped);
  }, []);
  const setSidePanel = useCallback((v: SidePanelKind) => {
    setSidePanelState(v);
    writeSidePanel(v);
  }, []);
  const setChainGreek = useCallback((v: ChainGreek) => {
    setChainGreekState(v);
    writeChainGreek(v);
  }, []);
  // One updater for the whole indicator blob: every control is a patch over the
  // current value, so no control needs to know about any other.
  const patchIndicators = useCallback((patch: Partial<IndicatorCfg>) => {
    setIndicatorsState((prev) => {
      const next = { ...prev, ...patch };
      writeIndicators(next);
      return next;
    });
  }, []);
  const patchEma = useCallback((i: number, patch: Partial<{ on: boolean; len: number }>) => {
    setIndicatorsState((prev) => {
      const emas = prev.emas.map((e, k) => (k === i ? { ...e, ...patch } : e));
      const next = { ...prev, emas };
      writeIndicators(next);
      return next;
    });
  }, []);

  // Replay is a command, not a stored setting: the button says on/off and the
  // cards do the rest. Closing the popover exits replay — leaving a chart
  // frozen mid-session behind a closed panel with no visible way back is the
  // kind of state that reads as a broken page.
  const toggleReplay = useCallback(() => {
    setPopover((prev) => {
      if (prev === "replay") {
        broadcastReplayCmd({ on: false });
        replayActiveRef.current = false;
        return null;
      }
      // Only START a replay that isn't already running. Coming back from the
      // Indicators panel must re-open the transport where you left it, not
      // rewind to the open — the command resets the cursor.
      if (!replayActiveRef.current) {
        broadcastReplayCmd({ on: true });
        replayActiveRef.current = true;
      }
      return "replay";
    });
  }, []);

  const togglePopover = useCallback((which: Exclude<Popover, null>) => {
    setPopover((prev) => {
      // Moving off Replay to another panel leaves replay running on purpose:
      // watching a replay while adjusting indicators is the whole point.
      return prev === which ? null : which;
    });
  }, []);

  // The home GEX card embeds this component. It wants exactly the chart, with
  // its own switcher in the dock and no page chrome — so short-circuit to one
  // card rather than growing an `embedded` branch through the layout below.
  if (embedded) {
    // density="full" pins the home card to the dock it has today. Its width sits
    // near the compact threshold, and this page's layout work has no business
    // silently restyling the home dashboard's toolbar.
    return <EsChartCard slot="embed" sidePanel="rail" leading={leading} embedded density="full" indicators={indicators} />;
  }

  const multi = cards > 1;

  // The three page-level controls, rendered INTO the chart's own dock. The page
  // still owns every piece of state behind them; only the pixels move.
  const toolbarButtons = (
    <div ref={anchorRef} style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      <DockButton
        onClick={() => togglePopover("charts")}
        title="Chart count and side panel"
        caret
        open={popover === "charts"}
        style={popover === "charts" ? { color: LIGHT_BLUE, borderColor: LIGHT_BLUE } : undefined}
      >
        <span>Charts</span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>{cards}</span>
      </DockButton>
      <DockButton
        onClick={toggleReplay}
        title="Replay the session — reveal candles and gamma from the open forward"
        caret
        open={popover === "replay"}
        style={popover === "replay" ? { color: HOME_THEME.cyan, borderColor: HOME_THEME.cyan } : undefined}
      >
        <span>Replay</span>
      </DockButton>
      <DockButton
        onClick={() => togglePopover("indicators")}
        title="Indicators — applied to every chart in the row"
        caret
        open={popover === "indicators"}
        style={popover === "indicators" ? { color: LIGHT_BLUE, borderColor: LIGHT_BLUE } : undefined}
      >
        <span>Indicators</span>
        {/* How many are ON, so a shut menu still answers "is anything drawing?" */}
        {(() => {
          const n = indicators.emas.filter((e) => e.on).length
            + [indicators.bb, indicators.weeklyEm, indicators.volume, indicators.rsi, indicators.countdown,
               indicators.singlePrint, indicators.excess].filter(Boolean).length;
          return n ? <span style={{ opacity: 0.5, fontSize: 10 }}>{n}</span> : null;
        })()}
      </DockButton>
      {/* Owns all of its own state — see LayoutPresetButton. */}
      <LayoutPresetButton />
    </div>
  );

  return (
    <div className="es-candles-page flex h-full flex-col" style={{ background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow }}>
      {/* The shared chart toolbar. Card 0 portals its dock in here when there
          are 2–3 charts; at one chart the card keeps its own dock and this stays
          empty (and unrendered, so it costs no vertical space). Either way the
          Charts / Replay / Indicators buttons ride inside that dock. */}
      {multi && (
        <div ref={setDockTarget} className="px-4 pt-3" style={{ position: "relative", zIndex: 35, minWidth: 0 }} />
      )}

      {/* One row. Equal columns, each free to shrink — minWidth:0 on the flex
          items, or a card's own dock would set a min-content floor and the row
          would overflow the viewport instead of the cards getting narrower. */}
      {/* `no-card-lift` because the dashboard-wide rule lifts any 16px-radius
          panel 2px on hover, and a chart that jumps when the cursor enters it
          drags the crosshair off the bar you were reading. */}
      <div
        className={`es-candles-row no-card-lift flex flex-1 flex-row px-2 pb-2 ${multi ? "gap-3" : "gap-2"}`}
        style={{ minHeight: 0 }}
      >
        {Array.from({ length: cards }, (_, i) => (
          <CardSlot key={i} carded={multi}>
            <EsChartCard
              slot={i}
              // Multi-chart: everything but the ticker moves to one shared blob,
              // so the hoisted toolbar drives all of them. Single chart: the
              // card keeps its own slot and nothing about it changes.
              settingsSlot={multi ? SHARED_SLOT : undefined}
              dockMode={!multi ? "full" : i === 0 ? "shared" : "symbol"}
              dockTarget={dockTarget}
              transportTarget={transportTarget}
              hostedReplay
              // Only the dock-rendering card gets the buttons. Handing them to
              // all three would be harmless today (the ticker-only cards don't
              // render a dock) but it is a duplicate set waiting for the first
              // layout change that gives those cards one.
              toolbarExtras={i === 0 ? toolbarButtons : undefined}
              sidePanel={sidePanel}
              chainGreek={chainGreek}
              indicators={indicators}
            />
          </CardSlot>
        ))}
      </div>

      {/* ── Popover ─────────────────────────────────────────────────────────
          `fixed`, measured off the buttons, for two reasons. It must not reflow
          the chart row — a panel that pushes the charts down resizes them, and
          every resize makes lightweight-charts rebuild its time scale, so three
          charts would flicker each time a menu opened. And its anchor lives
          inside the card's dock, which on a multi-chart row is portaled; there
          is nothing in this file's own layout to be absolute against. */}
      {popover && (
        <div
          className="es-candles-popover"
          style={{
            position: "fixed",
            top: anchorBottom + 8,
            left: 16,
            right: 16,
            zIndex: 60,
            padding: "12px 14px",
            borderRadius: 14,
            border: `1px solid ${HOME_THEME.border}`,
            background: "rgba(10,14,20,0.97)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "flex-start",
            // Column gap wide enough to read as separate groups, row gap for the
            // narrow-window wrap. Groups are fixed-height, so a wrapped second
            // line stays as straight as the first.
            columnGap: 22,
            rowGap: 14,
            flexWrap: "wrap",
            maxHeight: "min(60vh, 520px)",
            overflowY: "auto",
          }}
        >
          {popover === "charts" && (
            <>
              <Group label="Charts">
                <SegGroup
                  options={Array.from({ length: MAX_CARDS }, (_, i) => ({ label: String(i + 1), value: String(i + 1) }))}
                  active={String(cards)}
                  onChange={(v) => setCardCount(Number(v))}
                />
              </Group>
              <Group label="Panel">
                <SegGroup
                  options={PANEL_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                  active={sidePanel}
                  onChange={(v) => setSidePanel(v as SidePanelKind)}
                />
              </Group>
              {/* The chain's greek lives up here rather than in the panel itself for
                  a structural reason, not a cosmetic one: ChainRail's box has to be
                  exactly the chart container's box or its rows stop matching the
                  chart's prices, so nothing may sit above its canvas. */}
              {sidePanel === "chain" && (
                <Group label="Greek">
                  <SegGroup
                    options={CHAIN_GREEKS.map((g) => ({ label: GREEK_LABEL[g], value: g }))}
                    active={chainGreek}
                    onChange={(v) => setChainGreek(v as ChainGreek)}
                  />
                </Group>
              )}
            </>
          )}

          {/* Card 0 portals the transport in here. Always mounted while the
              popover is open, so the ref exists before the card looks for it. */}
          {popover === "replay" && (
            <div ref={setTransportTarget} style={{ width: "100%", minWidth: 0 }} />
          )}

          {popover === "indicators" && (
            <>
              {/* Each row is CHECKBOX + what it draws + its inputs, in that order.
                  The first version put a pill showing the EMA's length next to a
                  number field holding the same length — two identical numbers,
                  and no way to tell which one was the switch. */}
              <Group label="EMA">
                {indicators.emas.slice(0, MAX_EMAS).map((e, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "flex-end", gap: 5 }}>
                    <Toggle
                      on={e.on}
                      onClick={() => patchEma(i, { on: !e.on })}
                      swatch={EMA_COLORS[i]}
                      title={`Show the ${e.len}-bar EMA`}
                    >
                      EMA
                    </Toggle>
                    <NumField
                      value={e.len}
                      min={1}
                      max={400}
                      width={56}
                      title="Length, in bars"
                      onChange={(v) => patchEma(i, { len: Math.round(v) })}
                    />
                  </span>
                ))}
              </Group>

              <Group label="Bollinger">
                <Toggle on={indicators.bb} onClick={() => patchIndicators({ bb: !indicators.bb })}
                        title="Cloud between the inner and outer band">
                  Cloud
                </Toggle>
                <Field label="len">
                  <NumField value={indicators.bbPeriod} min={2} max={400} width={56} title="SMA period — the basis the bands are measured from"
                            onChange={(v) => patchIndicators({ bbPeriod: Math.round(v) })} />
                </Field>
                <Field label="inner σ">
                  <NumField value={indicators.bbInner} min={0.1} max={10} step={0.1} width={56} title="Inner cloud edge, in standard deviations"
                            onChange={(v) => patchIndicators({ bbInner: v })} />
                </Field>
                <Field label="outer σ">
                  <NumField value={indicators.bbOuter} min={0.1} max={10} step={0.1} width={56} title="Outer cloud edge, in standard deviations"
                            onChange={(v) => patchIndicators({ bbOuter: v })} />
                </Field>
              </Group>

              <Group label="Levels">
                <Toggle on={indicators.weeklyEm} onClick={() => patchIndicators({ weeklyEm: !indicators.weeklyEm })}
                        title="This week's published expected-move band">
                  Weekly EM
                </Toggle>
              </Group>

              {/* Both read the TPO profile the Overlays > TPO box chart is built
                  from, so they can never disagree with it - and neither needs
                  that overlay switched on, because the useful part is the level,
                  not the boxes. RTH because these are computed from the
                  9:30-16:00 profile ONLY: overnight trades a handful of
                  30-minute periods, so nearly every price is touched once and
                  "everything is a single print" is not a level. Bands run from
                  their session's open to the right edge, which is the only way a
                  print made at 10:15 is any use at 14:40. */}
              <Group label="TPO · RTH">
                <Toggle on={indicators.singlePrint} onClick={() => patchIndicators({ singlePrint: !indicators.singlePrint })}
                        title="Single prints - price bands the RTH profile touched in exactly one 30-minute period, away from the extremes. Price ran through, built no value, and tends to come back.">
                  Single prints
                </Toggle>
                <Toggle on={indicators.excess} onClick={() => patchIndicators({ excess: !indicators.excess })}
                        title="Excess - a tail of two or more single prints running off the RTH high (red: sellers rejected it) or the low (green: buyers did). A rejected extreme, as opposed to one that simply stopped.">
                  Excess
                </Toggle>
              </Group>

              <Group label="Study">
                <Toggle on={indicators.volume} onClick={() => patchIndicators({ volume: !indicators.volume })}
                        title="Volume histogram along the bottom of the chart">
                  Volume
                </Toggle>
                <Toggle on={indicators.rsi} onClick={() => patchIndicators({ rsi: !indicators.rsi })}
                        title="RSI, as a number in the chart's top right">
                  RSI
                </Toggle>
                <Field label="period">
                  <NumField value={indicators.rsiPeriod} min={2} max={100} width={56} title="RSI period"
                            onChange={(v) => patchIndicators({ rsiPeriod: Math.round(v) })} />
                </Field>
                <Toggle on={indicators.countdown} onClick={() => patchIndicators({ countdown: !indicators.countdown })}
                        title="Time left in the forming bar">
                  Bar countdown
                </Toggle>
              </Group>
            </>
          )}
        </div>
      )}
    </div>
  );
}
