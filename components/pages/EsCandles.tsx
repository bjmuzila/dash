"use client";

/**
 * /es-candles — a row of 1 to 3 candle charts under ONE toolbar.
 *
 * A single chart lives in components/dashboard/es-candles/EsChartCard.tsx; this
 * file is the workspace around it: how many charts, what rides their right
 * edge, what's drawn on all of them, and where the controls go.
 *
 * ── Where the controls live ─────────────────────────────────────────────────
 * One bar across the top, and it holds almost nothing: a title, the ticker, the
 * Replay toggle, refresh, the capture buttons, and a cog. Everything it used to
 * hold at once (chart count, panel choice, greek picker, timeframe, overlays,
 * expiry, indicators, presets, and per card a whole replay transport) added up
 * to more chrome than chart.
 *
 * The cog is a MASTER–DETAIL panel, not a menu: a rail of sections down the
 * left, one section's controls in the pane beside it, swapped in place. This
 * file contributes three of those sections through `pageSections` (Page,
 * Indicators, Layout); the card contributes the rest. See DockCogMenu.
 *
 * It got that way because the previous shape did not survive contact. Folding
 * the toolbar into a cog left the things INSIDE the cog still needing panels of
 * their own — an overlay checklist, an expiry list, a preset store, this file's
 * Charts and Indicators sheets — and a floating panel opened from inside a
 * floating panel has no idea where its parent is. Each one landed on top of its
 * parent, behind it, or half off-screen; each needed the parent's click-away
 * taught to ignore it by hand; and each z-index had to be tuned against every
 * other layer. Sections have none of those problems because there is nothing to
 * position. The rule this page now keeps: ONE floating layer, ever.
 *
 * Replay is the exception that proves it. It is a mode, not a setting, so its
 * button stays on the bar and its transport docks to the BOTTOM of the page for
 * as long as the replay runs — in flow, so it never covers the candles it is
 * scrubbing, with a ✕ of its own. The card still owns replay STATE (only it
 * knows how many bars the session has); this file only says on or off, over
 * slotStore's replay command channel.
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
 * The home dashboard still imports THIS file (app/home/HomeClient.tsx renders
 * `<EsCandlesPage embedded leading={gexViewSwitch} />`), so the `{ leading,
 * embedded }` signature is load-bearing. In that mode the page collapses to a
 * single card and renders no chrome of its own.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import EsChartCard from "@/components/dashboard/es-candles/EsChartCard";
import {
  MAX_CARDS, SHARED_SLOT, ensureMigrated,
  readCardCount, writeCardCount, readSidePanel, writeSidePanel,
  readEmbedSidePanel, writeEmbedSidePanel,
  readChainGreek, writeChainGreek,
  readIndicators, writeIndicators, broadcastReplayCmd, subscribeReplayCmd,
  INDICATORS_DEFAULT, MAX_EMAS,
  type SidePanelKind, type IndicatorCfg,
} from "@/components/dashboard/es-candles/slotStore";
import { EMA_COLORS } from "@/components/dashboard/es-candles/indicators";
import { CHAIN_GREEKS, GREEK_LABEL, isChainGreek, type ChainGreek } from "@/components/dashboard/es-candles/ChainRail";
import { DockButton, SegGroup, type DockCogSection } from "@/components/shared/DockToolbar";
import { Card } from "@/components/shared/PageCard";
import LayoutPresetButton from "@/components/dashboard/es-candles/LayoutPresetButton";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";

const PANEL_OPTIONS: Array<{ label: string; value: SidePanelKind }> = [
  { label: "None", value: "none" },
  { label: "Rail", value: "rail" },
  { label: "0DTE", value: "chain" },
];

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
 * A labelled group inside a cog section pane. The pane is dense by nature, so
 * the label is small, uppercase and quiet, and the controls sit right under it.
 * The row WRAPS — a pane is a few hundred pixels wide, not a full-bleed band.
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
      <div style={{ display: "flex", alignItems: "flex-end", flexWrap: "wrap", columnGap: 8, rowGap: 8, minHeight: ROW_H, minWidth: 0 }}>
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
  /**
   * The EMBEDDED card's side panel — the right-edge GEX rail, on or off.
   *
   * Its own state and its own storage key, NOT the `sidePanel` above: the embed
   * (the /home GEX card's ES view, the /board ES tile) is a narrow box sitting
   * beside a full GEX chart, so hiding the rail there is a decision about that
   * tile and must not strip it from the full /es-candles route.
   *
   * Mirrored into a ref so the toggle can read the current value without doing
   * it from inside a state updater — the write to localStorage is a side effect
   * and updaters must stay pure (React may run them twice under StrictMode).
   */
  const [embedPanel, setEmbedPanel] = useState<SidePanelKind>("rail");
  const embedPanelRef = useRef<SidePanelKind>("rail");
  const [chainGreek, setChainGreekState] = useState<ChainGreek>("gex");
  const [indicators, setIndicatorsState] = useState<IndicatorCfg>(INDICATORS_DEFAULT);
  // (No `popover` state any more. Charts / Indicators / Layout are SECTIONS of
  // the chart cog's rail — see `pageSections` below — so there is no floating
  // panel of this page's own to open, position, close on click-away, or keep
  // above the menu it was launched from.)
  // The shared dock's mount point. State, not a ref: card 0 renders into it via
  // a portal, and a ref wouldn't re-render the tree once the node exists.
  const [dockTarget, setDockTarget] = useState<HTMLDivElement | null>(null);
  // Where card 0 portals the replay transport. Lives in the bottom dock.
  const [transportTarget, setTransportTarget] = useState<HTMLDivElement | null>(null);
  // Is replay RUNNING, as distinct from "is its panel open". They come apart the
  // moment you open Indicators while a replay is going, and conflating them made
  // that round trip restart the replay from the open.
  const replayActiveRef = useRef(false);
  // The same fact as replayActiveRef, but as state so the Replay button can
  // render lit. It matters now that clicking away CLOSES the transport without
  // ending the replay: without a lit button, a running replay behind a closed
  // panel is invisible, which is the exact "reads as a broken page" state the
  // close-exits-replay rule was written to avoid.
  const [replayRunning, setReplayRunning] = useState(false);

  useEffect(() => {
    // Folds the pre-multi-card keys into slot blobs. Idempotent; no-ops once
    // slot 0 exists. (readSlot also calls it — React flushes child effects
    // before parent effects, so this one can't be relied on to run first.)
    ensureMigrated();
    setCards(readCardCount());
    setSidePanelState(readSidePanel());
    const ep = readEmbedSidePanel();
    embedPanelRef.current = ep;
    setEmbedPanel(ep);
    setIndicatorsState(readIndicators());
    const g = readChainGreek();
    if (isChainGreek(g)) setChainGreekState(g);
  }, []);

  // Keep `replayActiveRef` honest.
  //
  // A card can end a replay by itself — the transport's own ✕ / "● Live" buttons
  // are portaled into the bottom dock, and pressing either broadcasts
  // {on:false}. Without listening, this file would still believe a replay was
  // running: the dock would stay mounted around an empty transport, and the
  // next press of Replay would take the "already running" branch and turn
  // nothing back on.
  //
  // `replayRunning` is also what MOUNTS the dock (and therefore
  // `transportTarget`), so this subscription is load-bearing, not just cosmetic.
  useEffect(() => subscribeReplayCmd(({ on }) => {
    replayActiveRef.current = on;
    setReplayRunning(on);
  }), []);

  // (`closePopover`, the outside-click handler, the Escape handler and the
  // panel-placement effect all lived here. They existed to manage ONE hovering
  // panel that opened from inside another hovering panel. There is no such
  // panel now: DockCogMenu owns the only floating layer on this page, and the
  // controls that used to fly out of it are panes inside it.
  //
  // The `closePopover` blur dance went with them. It existed because React
  // unmounted a NumField before the browser delivered its blur, so clearing the
  // Bollinger length box and clicking the chart persisted `bbPeriod: 0` for the
  // session. A section pane unmounts only when you pick another section — by
  // clicking a rail button, which delivers the blur first.)
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
  /**
   * Embed only: show / hide the right-edge GEX rail.
   *
   * Two states, not the page's three. The 0DTE chain panel is twice the rail's
   * width and needs 340px of chart beside it — in a tile that is already the
   * narrow half of a dashboard it would be suppressed on width most of the time
   * anyway, so offering it here would be a button that mostly does nothing.
   */
  const toggleEmbedRail = useCallback(() => {
    const next: SidePanelKind = embedPanelRef.current === "none" ? "rail" : "none";
    embedPanelRef.current = next;
    setEmbedPanel(next);
    writeEmbedSidePanel(next);
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
  // cards do the rest.
  //
  // It no longer opens a popover. The transport is docked to the bottom of the
  // page for as long as the replay runs, so "is the panel open" and "is a
  // replay running" are now the SAME fact and there is nothing left to get out
  // of step — the state that used to leave a chart frozen behind a closed panel
  // is unrepresentable. On/off is the whole button.
  //
  // The side effects are OUTSIDE the state updater. They used to live inside
  // it, which was already a lie (a setState updater must be pure — React may
  // invoke it twice, and does under StrictMode), and it became a real hazard
  // once the page started SUBSCRIBING to the same channel it broadcasts on:
  // `broadcastReplayCmd` synchronously reaches the new subscriber below, which
  // calls setPopover again — re-entering the updater we are currently inside.
  // It happens to converge today because every branch lands on the same value;
  // it would stop the moment one returned `prev`. Reading the flag first and
  // acting after is the same behaviour with none of that.
  const toggleReplay = useCallback(() => {
    const on = !replayActiveRef.current;
    replayActiveRef.current = on;
    setReplayRunning(on);
    broadcastReplayCmd({ on });
  }, []);

  /**
   * The one page-owned control that rides ON the bar: Replay.
   *
   * Everything else this file used to put there — Charts, Indicators, Layout —
   * is a SECTION of the chart cog now (see `pageSections`). Replay stays out
   * because it is not a setting, it is a mode: one press starts it, the press
   * says whether it is running, and the transport it opens docks to the bottom
   * of the page. Two clicks deep behind a gear is the wrong depth for that, and
   * a lit gear could not say WHICH of seven sections is lit.
   *
   * Memoised: this node is handed to the (memo()'d) card as `toolbarExtras`, so
   * rebuilding it every render would defeat that memo on every parent render.
   *
   * Declared ABOVE the `embedded` early-return below, not next to its use site.
   * A hook after a conditional return is a rules-of-hooks violation, and it is a
   * live one here: the home GEX card renders this component with `embedded`, and
   * flipping that prop on the same element would change the hook count between
   * renders.
   */
  const toolbarButtons = useMemo(() => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      {/* No `caret`: this does not open a panel next to itself, it turns a mode
          on and docks the transport to the bottom of the page. A caret would
          promise a dropdown that never appears. */}
      <DockButton
        onClick={toggleReplay}
        title={replayRunning
          ? "Exit replay — back to live"
          : "Replay the session — reveal candles and gamma from the open forward"}
        style={replayRunning ? { color: HOME_THEME.cyan, borderColor: HOME_THEME.cyan } : undefined}
      >
        <span>Replay</span>
      </DockButton>
    </div>
  ), [replayRunning, toggleReplay]);

  /**
   * This page's contribution to the chart cog's section rail.
   *
   * These three are page state, not card state — one chart count, one indicator
   * blob and one preset store for the whole row — so the route owns them and
   * hands them down as panes. The card merges them with its own (Overlays,
   * Chart, Gamma) and decides the order; see `cogSections` in EsChartCard.
   *
   * Each of these used to be a floating panel that opened from INSIDE the cog:
   * Charts and Indicators from this file, Layout from its own portal. A panel
   * launched from inside a panel has no idea where its parent is — it landed on
   * top of it, behind it, or half off-screen, and each one needed the parent's
   * click-away taught to ignore it and its z-index tuned against every other
   * layer. As panes there is nothing to position and nothing to occlude.
   */
  const pageSections = useMemo<DockCogSection[]>(() => {
    const indicatorCount = indicators.emas.filter((e) => e.on).length
      + [indicators.bb, indicators.weeklyEm, indicators.volume, indicators.rsi, indicators.countdown].filter(Boolean).length;
    return [
      {
        id: "page",
        label: "Page",
        hint: "How many charts, and what rides their right edge",
        body: (
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
        ),
      },
      {
        id: "indicators",
        label: "Indicators",
        hint: "Drawn on every chart in the row",
        count: indicatorCount,
        body: (
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
        ),
      },
      {
        // Owns all of its own state — see LayoutPresetButton. `inline` drops its
        // trigger and its portal and hands back just the panel's contents.
        id: "layout",
        label: "Layout",
        hint: "Save and switch page layouts",
        body: <LayoutPresetButton inline />,
      },
    ];
  }, [cards, sidePanel, chainGreek, indicators, setCardCount, setSidePanel, setChainGreek, patchIndicators, patchEma]);

  // The GEX rail toggle, injected into the embedded card's own dock. Declared
  // with the other hooks, above the early return — a useMemo after a conditional
  // return is a rules-of-hooks violation, and `embedded` is a prop that can flip
  // on the same element (the home card's view switcher).
  const embedToolbarExtras = useMemo(() => (
    <DockButton
      onClick={toggleEmbedRail}
      title={embedPanel === "none"
        ? "Show the GEX rail on the right edge"
        : "Hide the GEX rail and give the width back to the candles"}
      style={embedPanel === "none" ? undefined : { color: LIGHT_BLUE, borderColor: LIGHT_BLUE }}
    >
      <span>Rail</span>
    </DockButton>
  ), [embedPanel, toggleEmbedRail]);

  // The home GEX card and the /board ES tile embed this component. They want
  // exactly the chart, with their own switcher in the dock and no page chrome —
  // so short-circuit to one card rather than growing an `embedded` branch
  // through the layout below.
  if (embedded) {
    // density="full" pins the home card to the dock it has today. Its width sits
    // near the compact threshold, and this page's layout work has no business
    // silently restyling the home dashboard's toolbar.
    return (
      <EsChartCard
        slot="embed"
        // Was hardcoded "rail". Now the embed's own remembered choice, driven by
        // the Rail button in `toolbarExtras` below.
        sidePanel={embedPanel}
        leading={leading}
        embedded
        density="full"
        indicators={indicators}
        toolbarExtras={embedToolbarExtras}
      />
    );
  }

  const multi = cards > 1;


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
              pageSections={i === 0 ? pageSections : undefined}
              sidePanel={sidePanel}
              chainGreek={chainGreek}
              indicators={indicators}
            />
          </CardSlot>
        ))}
      </div>

      {/* ── Replay transport ────────────────────────────────────────────────
          Docked to the BOTTOM of the page, in flow, for as long as the replay
          runs. It used to be portaled into the Charts/Indicators popover, which
          put a control surface you drive continuously — scrub, step, play — in
          a menu that closes when you click away, directly over the chart it is
          scrubbing. A transport belongs at the edge of the thing it drives.

          In flow rather than `fixed`: the bar must not cover the last inch of
          the candles, and it mounts/unmounts exactly twice per replay, so the
          one time-scale rebuild each way is a fair price for never occluding
          the chart. Card 0 portals the real controls into this node (see
          `transportTarget`), which is why it is a state ref, not a plain div. */}
      {replayRunning && (
        <div
          className="es-candles-transport-dock"
          style={{
            flexShrink: 0,
            minWidth: 0,
            borderTop: `1px solid ${HOME_THEME.border}`,
            background: "rgba(10,14,20,0.92)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            boxShadow: "0 -10px 30px rgba(0,0,0,0.35)",
            position: "relative",
            zIndex: 40,
          }}
        >
          <div ref={setTransportTarget} style={{ width: "100%", minWidth: 0 }} />
        </div>
      )}

    </div>
  );
}
