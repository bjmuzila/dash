"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useIsOwner } from "@/components/auth/useIsOwner";

// ─────────────────────────────────────────────────────────────────────────────
// BOT — the trade-alert composer, in the toolbar.
//
// Twin of cbedge-v3/src/shell/BotAlert.tsx. Two implementations exist because
// the two shells do not share a styling system (v3 is class-based on its design
// tokens, this is inline-styled on HOME_THEME) and v3's `@` alias points at its
// own src, so there is no import path between them. The FIELDS and the single
// POST are identical on purpose — a second, subtly different composer is how
// one surface starts posting alerts that do not look like the other's. Change
// one, change both.
//
// OWNER ONLY, TWICE. This renders nothing for anyone else — no button, no
// chunk. That is chrome: the real gate is /api/bot-alert, which checks the
// owner id server-side and 403s everyone else. useIsOwner is documented as
// cosmetic and FAILS CLOSED, which is the right pairing.
//
// The panel is `dynamic(..., { ssr: false })` so the composer is not in the
// toolbar's chunk — every visitor downloads GlobalToolbar, exactly one account
// can ever open this.
// ─────────────────────────────────────────────────────────────────────────────

const BotAlertPanel = dynamic(() => import("./BotAlertPanel"), { ssr: false });

const CYAN = "#219EBC";
const cyanA = (a: number) => `rgba(33,158,188,${a})`;

/** Broadcast tower — reads as "send", and is not a bell (that is Bzila's). */
function TowerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
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

export default function BotAlert() {
  const { isSignedIn } = useAuth();
  const isOwner = useIsOwner();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  // Escape closes; the outside-click handler lives in the panel, which is the
  // element that knows its own bounds (it is portaled out of this subtree).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!isSignedIn || !isOwner) return null;

  const toggle = () => {
    if (btnRef.current) setAnchor(btnRef.current.getBoundingClientRect());
    setOpen((v) => !v);
  };

  return (
    <div style={{ position: "relative", zIndex: 1, display: "flex" }}>
      <button
        ref={btnRef}
        data-bot-alert-trigger
        onClick={toggle}
        title="Broadcast a trade alert"
        aria-label="Broadcast a trade alert"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 42,
          height: 42,
          flexShrink: 0,
          borderRadius: "50%",
          border: `1px solid ${open || hover ? cyanA(0.55) : cyanA(0.35)}`,
          background: cyanA(0.14),
          color: "#7fd4e6",
          cursor: "pointer",
          boxShadow: open || hover ? `0 4px 12px -2px ${cyanA(0.45)}` : "none",
          transform: hover ? "translateY(-1px)" : "none",
          transition: "border-color 0.14s, box-shadow 0.14s, transform 0.14s",
        }}
      >
        <TowerIcon />
      </button>

      {open && <BotAlertPanel anchor={anchor} close={() => setOpen(false)} />}
    </div>
  );
}

export { CYAN, cyanA };
