import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { OWNER_THEME, rgba } from "../lib/theme";

/**
 * BOT — the trade-alert composer, in the owner toolbar.
 *
 * The BOT page is one click away in the sidebar, so this is not about reach: it
 * is about not losing the page you are on. Firing an alert from the Visitors
 * report or mid-way through Daily Grades should not mean navigating away and
 * navigating back.
 *
 * NO OWNER CHECK HERE, deliberately: AuthGate blocks this entire app for anyone
 * but the owner before a single route renders, so a second cosmetic check would
 * be theatre. /api/bot-alert is the real gate either way.
 *
 * lazy() for the same reason the other two shells do it — the composer is a few
 * KB that only matters once the button is pressed, and this toolbar is on every
 * owner page.
 */

const BotAlertPanel = lazy(() => import("./BotAlertPanel"));

/** Broadcast tower — reads as "send", and is not a bell. */
function TowerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 20 12 4l7 16" />
      <path d="M8.5 13h7" />
      <path d="M3.5 8.5a8 8 0 0 1 0-5M20.5 8.5a8 8 0 0 0 0-5" />
    </svg>
  );
}

export default function BotAlertButton() {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const CY = OWNER_THEME.cyan;

  // Escape closes. Outside-click lives in the panel, which is the element that
  // knows its own bounds — it is portaled out of this subtree.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = () => {
    if (btnRef.current) setAnchor(btnRef.current.getBoundingClientRect());
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={btnRef}
        data-bot-alert-trigger
        onClick={toggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title="Broadcast a trade alert"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          padding: "5px 10px",
          borderRadius: 7,
          cursor: "pointer",
          border: `1px solid ${open || hover ? rgba(CY, 0.55) : rgba(CY, 0.3)}`,
          background: open ? `linear-gradient(180deg, ${rgba(CY, 0.22)}, ${rgba(CY, 0.06)})` : rgba(CY, 0.1),
          color: CY,
          transition: "all 0.14s",
        }}
      >
        <TowerIcon />
        BOT
      </button>

      {open && (
        <Suspense fallback={null}>
          <BotAlertPanel anchor={anchor} close={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
