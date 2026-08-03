"use client";

import type { CSSProperties, ReactNode } from "react";
import MobileTabBar from "./MobileTabBar";
import { M_COLOR, SPACE, TYPE, scrollBody } from "./mobileTheme";

/**
 * MobileShell — the frame every phone page renders inside.
 *
 * Layout, top to bottom:
 *   [ GlobalToolbar ]   ← the universal toolbar, mounted by LayoutShell above
 *                         <main>. Not rendered here; the shell just lives
 *                         underneath it and must not assume a fixed height.
 *   [ page header    ]   optional: title + right slot
 *   [ sticky strip   ]   optional: expiry chips / filters, stays put while the
 *                         body scrolls
 *   [ body           ]   either a scroll region (lists) or a fixed fill (charts)
 *   [ MobileTabBar   ]   fixed, safe-area aware
 *
 * `fill` is the important switch. Chart pages must NOT scroll — a canvas that
 * swallows drag events inside a scrollable column means the user can neither
 * pan the chart nor scroll the page reliably. Those pages take the exact
 * remaining height and own their gestures. List pages scroll normally.
 */

export default function MobileShell({
  title,
  right,
  sticky,
  fill = false,
  children,
  bodyStyle,
}: {
  title?: string;
  right?: ReactNode;
  /** Pinned under the header — chips, filters, a search box. */
  sticky?: ReactNode;
  /** true = body is exactly the remaining height, no scroll (charts). */
  fill?: boolean;
  children: ReactNode;
  bodyStyle?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        // flex:1, not height:100%. <main> is a column flex container whose own
        // height comes from stretching inside a flex row, which is not a
        // definite containing block for a percentage — the shell resolved to
        // its content height and the tab bar floated mid-screen. flex:1 fills
        // the main axis regardless.
        flex: 1,
        minHeight: 0,
        position: "relative",
        color: M_COLOR.text,
        // The dashboard shell already paints HOME_THEME.bg + shellGlow behind
        // <main>; staying transparent lets that glow through instead of
        // flattening it with a second opaque layer.
        background: "transparent",
      }}
    >
      <MobileStyles />

      {(title || right) && (
        <header
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: `6px ${SPACE.md}px 4px`,
            minHeight: 30,
          }}
        >
          {title && (
            <h1
              style={{
                margin: 0,
                fontSize: TYPE.label,
                fontWeight: 800,
                letterSpacing: "0.13em",
                textTransform: "uppercase",
                color: M_COLOR.faint,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </h1>
          )}
          <span style={{ flex: 1, minWidth: 0 }} />
          {right}
        </header>
      )}

      {sticky && (
        <div style={{ flexShrink: 0, padding: `2px ${SPACE.md}px 8px` }}>{sticky}</div>
      )}

      <div
        style={
          fill
            ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", ...bodyStyle }
            : {
                ...scrollBody,
                padding: `0 ${SPACE.md}px`,
                paddingBottom: 18,
                display: "flex",
                flexDirection: "column",
                gap: SPACE.md,
                ...bodyStyle,
              }
        }
      >
        {children}
      </div>

      <MobileTabBar />
    </div>
  );
}

/**
 * The handful of things that genuinely need a stylesheet rather than an inline
 * style: scrollbar suppression, keyframes, and the iOS input zoom fix. Mounted
 * per page, but the rules are idempotent and the browser dedupes identical
 * text, so this costs nothing.
 */
function MobileStyles() {
  return (
    <style>{`
.cbm-hscroll::-webkit-scrollbar { display: none; }
.cbm-hscroll { scrollbar-width: none; -ms-overflow-style: none; }
.cbm-vscroll::-webkit-scrollbar { width: 0; height: 0; }
.cbm-vscroll { scrollbar-width: none; }

/* iOS Safari zooms the whole page when a focused input's font-size is < 16px.
   Every text field in the mobile pages is therefore 16px, and only its visual
   size is reduced via padding. */
.cbm-input { font-size: 16px; }

@keyframes cbm-sheet-up {
  from { transform: translateY(14px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
.cbm-sheet-in { animation: cbm-sheet-up 0.2s cubic-bezier(0.22, 1, 0.36, 1); }

@keyframes cbm-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}
.cbm-pulse { animation: cbm-pulse 2s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .cbm-sheet-in, .cbm-pulse { animation: none; }
}
`}</style>
  );
}
