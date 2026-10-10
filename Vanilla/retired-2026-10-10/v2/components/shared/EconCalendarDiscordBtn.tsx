"use client";

/**
 * EconCalendarDiscordBtn
 *
 * Two owner-only buttons that snapshot the Economic Calendar: one posts to
 * Discord, one copies to the clipboard.
 *
 * This file is deliberately thin. The layout lives in lib/discord/econSnapshot
 * and the upload in lib/discord/share — they used to be inlined here, which
 * meant a CSS tweak and a transport fix were edits to the same 700-line file.
 * Keep it that way: no HTML, no CSS, no fetch plumbing below.
 */

import { useState, useCallback } from "react";
import { useIsOwner } from "@/components/auth/useIsOwner";
import { buildCalendarTemplateImage } from "@/lib/discord/econSnapshot";
import { shareToDiscord, base64ToPngBlob } from "@/lib/discord/share";
import { copyOrDownload } from "@/lib/snapshot";

type TemplateBtnState = "idle" | "busy" | "ok" | "err";

// Owner gate (cosmetic) comes from the shared useIsOwner() hook. The local copy
// that used to live here fell back to `!!isSignedIn` when
// NEXT_PUBLIC_OWNER_USER_ID was missing from the build, so both buttons below
// rendered for every signed-in customer. The shared hook fails closed.

function postToDiscord(imageBase64: string): Promise<void> {
  const now = new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
  return shareToDiscord({
    content: `📅 **Economic Calendar** — ${today} · ${now} ET`,
    image: imageBase64,
    filename: "econ-calendar.png",
  });
}

async function copyImageToClipboard(imageBase64: string): Promise<"copied" | "saved"> {
  // Via the shared helper so this button gets the same clipboard-then-download
  // fallback as every other snapshot button. A bare clipboard.write() throws
  // wherever image writes aren't implemented (Firefox, older Safari) or outside
  // a secure context, and this handler turned that into a silent "ERR" with no
  // image — the one capture path in the app that could leave you empty-handed.
  return copyOrDownload(base64ToPngBlob(imageBase64), "econ-calendar.png");
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconDiscord({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function IconCamera({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

// ── Components ────────────────────────────────────────────────────────────────

export default function EconCalendarDiscordBtn() {
  const [s, set] = useState<TemplateBtnState>("idle");
  const isOwner = useIsOwner();

  const run = useCallback(async () => {
    if (s === "busy") return;
    set("busy");
    try {
      const img = await buildCalendarTemplateImage();
      await postToDiscord(img);
      set("ok");
    } catch (e) {
      // shareToDiscord throws the server's actual error text — log it whole.
      console.error("[EconCalendarDiscordBtn]", e);
      set("err");
    } finally {
      setTimeout(() => set("idle"), 1800);
    }
  }, [s]);

  // Discord share is owner-only (cosmetic gate).
  if (!isOwner) return null;

  const color = s === "ok" ? "#00e676" : s === "err" ? "#ef4444" : "#7289da";
  const statusLabel = s === "busy" ? "..." : s === "ok" ? "OK" : s === "err" ? "ERR" : null;

  return (
    <button
      onClick={run}
      disabled={s === "busy"}
      title="Share Economic Calendar snapshot to Discord"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        padding: "2px 5px",
        border: `1px solid ${color}40`,
        borderRadius: 2,
        background: "rgba(255,255,255,0.04)",
        color,
        cursor: s === "busy" ? "default" : "pointer",
        fontSize: statusLabel ? 9 : 0, fontWeight: 700, letterSpacing: ".08em",
        fontFamily: "inherit", flexShrink: 0,
        transition: "color .15s, border-color .15s",
      }}
    >
      {statusLabel ?? <IconDiscord />}
    </button>
  );
}

export function EconCalendarTemplateCopyBtn() {
  const [s, set] = useState<TemplateBtnState>("idle");
  const isOwner = useIsOwner();

  const run = useCallback(async () => {
    if (s === "busy") return;
    set("busy");
    try {
      const img = await buildCalendarTemplateImage();
      await copyImageToClipboard(img);
      set("ok");
    } catch (e) {
      console.error("[EconCalendarTemplateCopyBtn]", e);
      set("err");
    } finally {
      setTimeout(() => set("idle"), 1800);
    }
  }, [s]);

  if (!isOwner) return null;

  const color = s === "ok" ? "#00e676" : s === "err" ? "#ef4444" : "#a78bfa";
  const statusLabel = s === "busy" ? "..." : s === "ok" ? "OK" : s === "err" ? "ERR" : null;

  return (
    <button
      onClick={run}
      disabled={s === "busy"}
      title="Copy the economic calendar template to clipboard"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2px 5px",
        border: `1px solid ${color}40`,
        borderRadius: 2,
        background: "rgba(255,255,255,0.04)",
        color,
        cursor: s === "busy" ? "default" : "pointer",
        fontSize: statusLabel ? 9 : 0,
        fontWeight: 700,
        fontFamily: "inherit",
        flexShrink: 0,
        transition: "color .15s, border-color .15s",
      }}
    >
      {statusLabel ?? <IconCamera />}
    </button>
  );
}
