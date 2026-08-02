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
import { CHAIN_GREEKS, GREEK_LABEL, isChainGreek, type ChainGreek } from "@/components/dashboard/es-candles/ChainRail";
import { Dock, DockGap, DockButton, SegGroup } from "@/components/shared/DockToolbar";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";

const PANEL_OPTIONS: Array<{ label: string; value: SidePanelKind }> = [
  { label: "None", value: "none" },
  { label: "Rail", value: "rail" },
  { label: "0DTE", value: "chain" },
];

/** Which popover is open. Exactly one at a time — two hovering panels would overlap. */
type Popover = "charts" | "replay" | "indicators" | null;

/**
 * A labelled group inside a popover. Popovers are dense by nature, so the label
 * is small, uppercase and quiet, and the control sits right under it.
 */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.muted, whiteSpace: "nowrap" }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{children}</div>
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
        height: 30,
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

/** On/off pill. Reads as a switch rather than as a button that does something. */
function Toggle({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        height: 30,
        padding: "0 10px",
        borderRadius: 8,
        border: `1px solid ${on ? LIGHT_BLUE : HOME_THEME.border}`,
        background: on ? "rgba(41,182,246,0.16)" : "rgba(255,255,255,0.03)",
        color: on ? LIGHT_BLUE : HOME_THEME.muted,
        fontSize: 12,
        fontWeight: 800,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
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
  const popRef = useRef<HTMLDivElement | null>(null);
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

  return (
    <div className="es-candles-page flex h-full flex-col" style={{ background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow }}>
      {/* ── The one toolbar ───────────────────────────────────────────────── */}
      <div className="px-4 pt-3" style={{ position: "relative", zIndex: 40 }}>
        <Dock className="dock-noscroll" noScroll style={{ minWidth: 0 }}>
          <span className="font-bold uppercase tracking-[0.2em]" style={{ fontSize: 13, color: LIGHT_BLUE, whiteSpace: "nowrap" }}>
            Candles
          </span>
          <DockGap />
          <DockButton
            onClick={() => togglePopover("charts")}
            title="Chart count and side panel"
            style={popover === "charts" ? { color: LIGHT_BLUE, borderColor: LIGHT_BLUE } : undefined}
          >
            <span>Charts</span>
            <span style={{ opacity: 0.5, fontSize: 10 }}>{cards}</span>
          </DockButton>
          <DockButton
            onClick={toggleReplay}
            title="Replay the session — reveal candles and gamma from the open forward"
            style={popover === "replay" ? { color: HOME_THEME.cyan, borderColor: HOME_THEME.cyan } : undefined}
          >
            <span>Replay</span>
          </DockButton>
          <DockButton
            onClick={() => togglePopover("indicators")}
            title="Indicators — applied to every chart in the row"
            style={popover === "indicators" ? { color: LIGHT_BLUE, borderColor: LIGHT_BLUE } : undefined}
          >
            <span>Indicators</span>
            {/* Count of what's on, so a closed menu still says whether anything is. */}
            {(() => {
              const n = indicators.emas.filter((e) => e.on).length
                + [indicators.bb, indicators.weeklyEm, indicators.volume, indicators.rsi, indicators.countdown].filter(Boolean).length;
              return n ? <span style={{ opacity: 0.5, fontSize: 10 }}>{n}</span> : null;
            })()}
          </DockButton>
        </Dock>

        {/* ── Popover ───────────────────────────────────────────────────────
            Absolutely positioned so opening it does NOT reflow the chart row.
            A panel that pushes the charts down resizes them, and every resize
            makes lightweight-charts rebuild its time scale — three charts
            flickering every time a menu opens. */}
        {popover && (
          <div
            ref={popRef}
            className="es-candles-popover"
            style={{
              position: "absolute",
              top: "100%",
              left: 16,
              right: 16,
              marginTop: 6,
              zIndex: 60,
              padding: "12px 14px",
              borderRadius: 14,
              border: `1px solid ${HOME_THEME.border}`,
              background: "rgba(10,14,20,0.97)",
              backdropFilter: "blur(14px)",
              boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
              display: "flex",
              alignItems: "flex-start",
              gap: 18,
              flexWrap: "wrap",
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
                <Group label="EMA">
                  {indicators.emas.slice(0, MAX_EMAS).map((e, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Toggle on={e.on} onClick={() => patchEma(i, { on: !e.on })} title={`EMA ${e.len}`}>
                        {e.len}
                      </Toggle>
                      <NumField
                        value={e.len}
                        min={1}
                        max={400}
                        width={54}
                        title="Length in bars"
                        onChange={(v) => patchEma(i, { len: Math.round(v) })}
                      />
                    </span>
                  ))}
                </Group>

                <Group label="Bollinger">
                  <Toggle on={indicators.bb} onClick={() => patchIndicators({ bb: !indicators.bb })}>Cloud</Toggle>
                  <NumField value={indicators.bbPeriod} min={2} max={400} width={54} title="SMA period (basis)"
                            onChange={(v) => patchIndicators({ bbPeriod: Math.round(v) })} />
                  <NumField value={indicators.bbInner} min={0.1} max={10} step={0.1} width={54} title="Inner cloud edge (σ)"
                            onChange={(v) => patchIndicators({ bbInner: v })} />
                  <NumField value={indicators.bbOuter} min={0.1} max={10} step={0.1} width={54} title="Outer cloud edge (σ)"
                            onChange={(v) => patchIndicators({ bbOuter: v })} />
                </Group>

                <Group label="Levels">
                  <Toggle on={indicators.weeklyEm} onClick={() => patchIndicators({ weeklyEm: !indicators.weeklyEm })}
                          title="This week's expected-move band from the EM tracker">
                    Weekly EM
                  </Toggle>
                </Group>

                <Group label="Study">
                  <Toggle on={indicators.volume} onClick={() => patchIndicators({ volume: !indicators.volume })}
                          title="Volume histogram along the bottom of the chart">
                    Volume
                  </Toggle>
                  <Toggle on={indicators.rsi} onClick={() => patchIndicators({ rsi: !indicators.rsi })}
                          title="RSI, shown as a number in the chart's top right">
                    RSI
                  </Toggle>
                  <NumField value={indicators.rsiPeriod} min={2} max={100} width={54} title="RSI period"
                            onChange={(v) => patchIndicators({ rsiPeriod: Math.round(v) })} />
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

      {/* The shared chart toolbar. Card 0 portals its dock in here when there
          are 2–3 charts; at one chart the card keeps its own dock and this stays
          empty (and unrendered, so it costs no vertical space). */}
      {multi && (
        <div ref={setDockTarget} className="px-4" style={{ position: "relative", zIndex: 35, minWidth: 0 }} />
      )}

      {/* One row. Equal columns, each free to shrink — minWidth:0 on the flex
          items, or a card's own dock would set a min-content floor and the row
          would overflow the viewport instead of the cards getting narrower. */}
      <div className="es-candles-row flex flex-1 flex-row gap-2 px-2 pb-2" style={{ minHeight: 0 }}>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="flex flex-1 flex-col" style={{ minWidth: 0, minHeight: 0 }}>
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
              sidePanel={sidePanel}
              chainGreek={chainGreek}
              indicators={indicators}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
