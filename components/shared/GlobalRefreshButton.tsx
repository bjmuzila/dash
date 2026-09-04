"use client";

/**
 * GlobalRefreshButton — the one refresh control in the app.
 *
 * Mounted once, inside GlobalToolbar, which LayoutShell renders around every
 * routed page. That single mount point is the whole reason this exists as a
 * component rather than a per-page button: the toolbar is universal, so the
 * desktop dashboard and the phone build (/m/*) both get it without either one
 * knowing about it, and there is exactly one place to change how refresh looks
 * or behaves.
 *
 * WHAT IT REFRESHES
 * -----------------
 * Whatever the current route actually reads. It calls `refreshAll()` from
 * lib/refreshBus, and the sources in that registry are registered by the data
 * hooks themselves for as long as they are mounted — see the header of
 * lib/refreshBus.ts. Nothing here knows which page it is on, and nothing needs
 * to be added here when a page is.
 *
 * THE STATE MACHINE IS hooks/useRefreshButton.ts, NOT A NEW ONE
 * ------------------------------------------------------------
 * That hook already owns idle → refreshing → success/error → idle with the
 * re-entrancy lock and the settle delay, and page-level refresh buttons
 * elsewhere in the app are built on it. It is reused here for exactly that; the
 * only thing not taken from it is `style`, because its style is a text pill
 * ("↻ Now") and the toolbar wants a round icon button the size of the
 * hamburger and the notes bell beside it. The COLORS are still the theme's —
 * REFRESH_GREEN / HOME_THEME.red / HOME_THEME.cyan, the same three values that
 * hook's own style function uses, and on /m/* the mobileTheme aliases of them.
 *
 * FEEDBACK
 * --------
 * Three visible states, because a refresh that changes one number in a corner
 * is otherwise indistinguishable from a button that did nothing:
 *   refreshing — the glyph spins, the button is disabled and dimmed
 *   success    — green ring + glow, ~1.8s, then back to idle
 *   error      — red ring + glow, same dwell
 * The dwell is the hook's; the flash is a CSS transition on the border and
 * shadow so it settles rather than blinks.
 */

import { useEffect, useState } from "react";
import { HOME_THEME, REFRESH_GREEN } from "./homeTheme";
import { M_COLOR, TAP, noTapHighlight, rgba } from "@/components/mobile/mobileTheme";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { onRefreshSourceCount, refreshAll, refreshSourceCount } from "@/lib/refreshBus";

/** Injected once per document — a spin keyframe the toolbar can't get from globals. */
const SPIN_KEYFRAMES = `@keyframes cb-refresh-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`;
const SPIN_STYLE_ID = "cb-refresh-spin-style";

function useSpinKeyframes(): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(SPIN_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = SPIN_STYLE_ID;
    el.textContent = SPIN_KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

function RefreshGlyph({ size, spinning }: { size: number; spinning: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{
        display: "block",
        transformOrigin: "50% 50%",
        animation: spinning ? "cb-refresh-spin 0.75s linear infinite" : "none",
      }}
    >
      {/* Two three-quarter arcs with arrowheads — a full circle would read as a
          loading spinner even at rest, which is the one thing it must not do. */}
      <path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9" />
      <path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9" />
      <polyline points="18.1 2.4 18.1 6.6 13.9 6.6" />
      <polyline points="5.9 21.6 5.9 17.4 10.1 17.4" />
    </svg>
  );
}

export default function GlobalRefreshButton({
  /** Narrow viewport — matches the toolbar's own `isMobile`. */
  compact = false,
  /** On the phone build (/m/*), where the tokens come from mobileTheme. */
  mobile = false,
}: {
  compact?: boolean;
  mobile?: boolean;
}) {
  useSpinKeyframes();
  const { trigger, state } = useRefreshButton(refreshAll);
  const [hover, setHover] = useState(false);

  // How many hooks on this route can be refreshed. Zero means the route has no
  // registered source — the button stays visible (its absence on one page would
  // read as a bug) but says so rather than flashing a green tick over nothing.
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(refreshSourceCount());
    return onRefreshSourceCount(setCount);
  }, []);

  const busy = state === "refreshing";
  const ok = state === "success";
  const bad = state === "error";

  // One palette, two spellings of it. M_COLOR.up / .down / .cyan ARE
  // REFRESH_GREEN / SOFT_RED / HOME_THEME.cyan re-exported (see mobileTheme's
  // header) — reading them through the mobile module on /m/* is what keeps the
  // phone build honest to its own token file rather than to this one.
  const green = mobile ? M_COLOR.up : REFRESH_GREEN;
  const red = mobile ? M_COLOR.down : HOME_THEME.red;
  const cyan = mobile ? M_COLOR.cyan : HOME_THEME.cyan;

  const accent = ok ? green : bad ? red : cyan;
  const lit = ok || bad || hover;

  // The toolbar's round-button geometry: 42px desktop, 34px on a narrow pill.
  // TAP.min is the phone build's minimum touch target, so /m/* never goes under
  // it even when `compact` is true.
  const box = mobile ? Math.max(TAP.min - 8, 36) : compact ? 34 : 42;
  const glyph = mobile ? 19 : compact ? 17 : 20;

  const title = busy
    ? "Refreshing…"
    : ok
      ? "Refreshed"
      : bad
        ? "Refresh failed — tap to retry"
        : count === 0
          ? "Nothing on this page to refresh"
          : `Refresh this page's data (${count} source${count === 1 ? "" : "s"})`;

  return (
    <div style={{ position: "relative", zIndex: 1, display: "flex", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => void trigger()}
        disabled={busy}
        title={title}
        aria-label={title}
        aria-busy={busy}
        aria-live="polite"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          ...noTapHighlight,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: box,
          height: box,
          flexShrink: 0,
          borderRadius: "50%",
          border: `1px solid ${lit ? rgba(accent, 0.55) : rgba(accent, 0.3)}`,
          background: ok
            ? rgba(green, 0.14)
            : bad
              ? rgba(red, 0.14)
              : busy
                ? "rgba(255,255,255,0.04)"
                : rgba(cyan, 0.1),
          color: busy ? M_COLOR.faint : accent,
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.65 : 1,
          boxShadow: lit ? `0 0 14px -2px ${rgba(accent, 0.55)}` : "none",
          transform: hover && !busy ? "translateY(-1px)" : "none",
          transition:
            "background 0.16s, border-color 0.16s, color 0.16s, box-shadow 0.22s, transform 0.14s, opacity 0.16s",
        }}
      >
        <RefreshGlyph size={glyph} spinning={busy} />
      </button>
    </div>
  );
}
