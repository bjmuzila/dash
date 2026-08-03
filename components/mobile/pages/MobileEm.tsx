"use client";

import { useEffect, useState } from "react";
import { POPULAR, emNumber, fmtUpdated, useEmLookup, val } from "@/hooks/useEmLookup";
import MobileShell from "../MobileShell";
import { SearchIcon } from "../MobileIcons";
import { MCard, MChipRow, MEmpty, MStat, MStatGrid } from "../MobileUI";
import { M_COLOR, MONO, RADIUS, TYPE, gridCols, mTile, rgba } from "../mobileTheme";

/**
 * MobileEm — the weekly Estimated Moves page, phone edition.
 *
 * The desktop EmCustomer cannot be restyled into this. Its numbers are inline
 * `style={{}}` objects — a `repeat(4, 1fr)` grid whose cells resolve to 71px on
 * a 390px screen, holding 21px monospace values like "6,152.50" that need ~100px
 * — so overriding it from a stylesheet would mean `!important` rules matched on
 * inline-style substrings against a component with no class names. The layout
 * here is new; the DATA is the desktop's, through the shared useEmLookup hook.
 *
 * What is dropped, and why:
 *   - the 144px logo — 40% of the vertical viewport before a single number
 *   - the snapshot-to-clipboard button — `navigator.clipboard.write` with a
 *     ClipboardItem is unreliable on iOS Safari
 *   - the CB Confidence tile — its endpoint returns an object where the code
 *     expects a scalar, so it renders empty on desktop too (see useEmLookup)
 *   - the two paragraphs of zone prose, folded into one line each
 */

function Zone({
  kind,
  near,
  far,
}: {
  kind: "buy" | "sell";
  near: string;
  far: string;
}) {
  const buy = kind === "buy";
  const color = buy ? M_COLOR.up : M_COLOR.down;
  return (
    <div
      style={{
        ...mTile,
        padding: "10px 12px",
        background: `linear-gradient(180deg, ${rgba(color, 0.1)}, rgba(255,255,255,0.02))`,
        boxShadow: `inset 0 0 0 1px ${rgba(color, 0.22)}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: TYPE.micro, fontWeight: 800, letterSpacing: "0.1em", color }}>
          {buy ? "BUY ZONE" : "SELL ZONE"}
        </span>
        <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint }}>
          {buy ? "support — bias long above" : "resistance — bias short below"}
        </span>
      </div>
      <div style={{ display: "grid", ...gridCols("1fr 1fr"), gap: 8 }}>
        {[
          { k: "NEAR", v: near },
          { k: "FAR", v: far },
        ].map((r) => (
          <div key={r.k} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
            <span style={{ fontSize: TYPE.micro, fontWeight: 700, color: M_COLOR.faint }}>{r.k}</span>
            <span style={{ ...MONO, fontSize: TYPE.value + 1, fontWeight: 700, color, whiteSpace: "nowrap" }}>
              {r.v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MobileEm() {
  const [input, setInput] = useState("");
  const em = useEmLookup();

  // Land on something useful instead of an empty form, and honour ?ticker=.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("ticker");
    const start = (t || "SPX").toUpperCase();
    setInput(start);
    void em.lookup(start);
    // Run once on mount — `em.lookup` is a stable useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const d = em.data;
  const emVal = emNumber(d?.em ?? null);
  const winPct = em.winRate ? Math.round(em.winRate.hit_rate * 100) : null;

  const pick = (t: string) => {
    setInput(t);
    void em.lookup(t);
  };

  const vsAvg = (avg: number | null) => {
    if (avg == null || emVal == null || avg <= 0) return null;
    const pct = ((emVal - avg) / avg) * 100;
    return { pct, up: pct >= 0 };
  };
  const vs4 = vsAvg(em.emStats?.recentAvg ?? null);
  const vs12 = vsAvg(em.emStats?.midAvg ?? null);

  return (
    <MobileShell
      title="Estimated Moves"
      sticky={
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 38,
              padding: "0 12px",
              borderRadius: RADIUS.pill,
              border: `1px solid ${M_COLOR.border}`,
              background: "rgba(255,255,255,0.04)",
              color: M_COLOR.faint,
            }}
          >
            <SearchIcon size={16} />
            <input
              className="cbm-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                  void em.lookup(input);
                }
              }}
              placeholder="Ticker — SPX, NVDA, ESU…"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                outline: "none",
                background: "transparent",
                color: M_COLOR.text,
                fontWeight: 700,
                letterSpacing: "0.04em",
                padding: 0,
              }}
            />
          </div>
          <MChipRow items={POPULAR.map((t) => ({ id: t, label: t }))} activeId={em.ticker} onSelect={pick} />
        </div>
      }
    >
      {em.loading && !d ? (
        <MEmpty tall>Loading {em.ticker}…</MEmpty>
      ) : em.error && !d ? (
        <MEmpty tall>{em.error}</MEmpty>
      ) : !d ? (
        <MEmpty tall>Search a ticker to see this week&rsquo;s estimated move.</MEmpty>
      ) : (
        <>
          {/* Identity */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap", paddingTop: 2 }}>
            <span style={{ fontSize: TYPE.hero - 2, fontWeight: 800, lineHeight: 1 }}>
              {d.label || d.ticker || em.ticker}
            </span>
            {d.exp_label && (
              <span
                style={{
                  fontSize: TYPE.micro,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: M_COLOR.cyan,
                  border: `1px solid ${rgba(M_COLOR.cyan, 0.35)}`,
                  background: rgba(M_COLOR.cyan, 0.1),
                  borderRadius: RADIUS.pill,
                  padding: "3px 9px",
                }}
              >
                WEEK OF {d.exp_label}
              </span>
            )}
            {d.updated_at && (
              <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint }}>{fmtUpdated(d.updated_at)}</span>
            )}
          </div>

          {/* The product: four numbers. 2x2, not the desktop's 4-up — at 390px
              a 4-up grid gives each cell 71px for a value that needs ~100. */}
          <MCard title="This week">
            <MStatGrid cols={2}>
              <MStat label="Close" value={val(d.close)} />
              <MStat label="Est. move" value={val(d.em)} accent={M_COLOR.orange} />
              <MStat label="Upside" value={val(d.up)} accent={M_COLOR.up} />
              <MStat label="Downside" value={val(d.down)} accent={M_COLOR.down} />
            </MStatGrid>
          </MCard>

          {/* Zones, stacked — side-by-side puts a 22px value in a 132px box
              next to its label and they collide. */}
          {(d.buy_near || d.sell_near) && (
            <MCard title="Zones" padded={false} style={{ background: "transparent", border: "none", boxShadow: "none" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(d.buy_near || d.buy_far) && <Zone kind="buy" near={val(d.buy_near)} far={val(d.buy_far)} />}
                {(d.sell_near || d.sell_far) && <Zone kind="sell" near={val(d.sell_near)} far={val(d.sell_far)} />}
              </div>
            </MCard>
          )}

          {/* Track record */}
          {(winPct != null || em.recentRec) && (
            <MCard title="Track record">
              <MStatGrid cols={2}>
                {winPct != null && em.winRate && (
                  <MStat
                    label="Hit rate"
                    value={`${winPct}%`}
                    accent={winPct >= 50 ? M_COLOR.up : M_COLOR.down}
                    sub={`${em.winRate.hits}/${em.winRate.evaluated} weeks`}
                  />
                )}
                {em.recentRec?.lastResult && (
                  <MStat
                    label="Last week"
                    value={em.recentRec.lastResult === "hit" ? "HIT" : "MISS"}
                    accent={em.recentRec.lastResult === "hit" ? M_COLOR.up : M_COLOR.down}
                    sub={em.recentRec.lastLabel ?? undefined}
                  />
                )}
                {em.recentRec && em.recentRec.last5Total > 0 && (
                  <MStat
                    label="Last 5"
                    value={`${em.recentRec.last5Hits}/${em.recentRec.last5Total}`}
                    accent={M_COLOR.blue}
                  />
                )}
                {em.emStats?.sampleSize ? (
                  <MStat label="Sample" value={`${em.emStats.sampleSize} wks`} />
                ) : null}
              </MStatGrid>
            </MCard>
          )}

          {/* vs history */}
          {(vs4 || vs12) && (
            <MCard title="vs historical average">
              <MStatGrid cols={2}>
                {vs4 && (
                  <MStat
                    label="vs 4-week"
                    value={`${vs4.up ? "▲" : "▼"} ${Math.abs(vs4.pct).toFixed(1)}%`}
                    accent={vs4.up ? M_COLOR.orange : M_COLOR.blue}
                    sub={em.emStats?.recentAvg ? em.emStats.recentAvg.toFixed(2) : undefined}
                  />
                )}
                {vs12 && (
                  <MStat
                    label="vs 12-week"
                    value={`${vs12.up ? "▲" : "▼"} ${Math.abs(vs12.pct).toFixed(1)}%`}
                    accent={vs12.up ? M_COLOR.orange : M_COLOR.blue}
                    sub={em.emStats?.midAvg ? em.emStats.midAvg.toFixed(2) : undefined}
                  />
                )}
              </MStatGrid>
            </MCard>
          )}

          <p style={{ fontSize: TYPE.micro, lineHeight: 1.5, color: M_COLOR.faint, margin: "2px 2px 6px" }}>
            Estimated moves are model output from option pricing at the Friday 4:00pm ET close and are held
            flat for the week. Informational only — not a recommendation or a forecast.
          </p>
        </>
      )}
    </MobileShell>
  );
}
