"use client";

import { useState } from "react";
import { HOME_THEME as HT } from "@/components/shared/homeTheme";

/**
 * Earnings-chip company logo, shared by the home Economic Calendar panel
 * (components/dashboard/EconCalendarPanel.tsx) and the standalone
 * /economic-calendar page. One component so a logo dropped into public/logos
 * shows up in both places.
 *
 * Resolution order:
 *   1. /logos/<SYM>.png?v=LOGO_REV — mirrored, same-origin, immutably cached
 *      (scripts/fetch-ticker-logos.mjs writes these; next.config.js sets the
 *      Cache-Control). The ?v is load-bearing — see LOGO_REV below. Preferred
 *      because the resolver below costs TWO round
 *      trips per chip: /proxy/ticker-logo does a PG lookup + a HEAD to GitHub +
 *      up to two Wikidata calls before 302-ing the browser to a third-party
 *      host it has no warm connection to. That was ~2.4s of tail on the home
 *      waterfall, on the default tab, on every load.
 *   2. /proxy/ticker-logo — live resolver, for symbols not yet mirrored.
 *   3. Ticker-text chip — nothing resolved.
 */

/**
 * Mirror revision. BUMP THIS whenever files are added to public/logos.
 *
 * Why a version query is not optional here: next.config.js serves /logos/:path*
 * with `Cache-Control: immutable, max-age=1y`, and Next applies those headers to
 * the PATH — it has no idea whether the file exists. So every request for a
 * ticker we had not mirrored yet came back as a 404 marked immutable, and the
 * browser then refused to ask again for a YEAR. Adding the PNG later changed
 * nothing: the tab kept drawing the ticker-text chip out of a cached 404. That
 * is exactly what happened to the 19 logos added 2026-08-23 — they were on disk
 * and still invisible.
 *
 * The query makes each mirror generation a distinct URL, so a stale 404 for
 * `?v=1` can never answer a request for `?v=2`. next.config.js only marks the
 * VERSIONED form immutable now, so this is belt and braces — but the belt is
 * what fixes the browsers that already hold the bad entry.
 */
export const LOGO_REV = 2;

function localLogoUrl(sym: string) {
  return `/logos/${encodeURIComponent(sym.toUpperCase())}.png?v=${LOGO_REV}`;
}

function proxyLogoUrl(sym: string, name?: string) {
  return `/proxy/ticker-logo?sym=${encodeURIComponent(sym.toUpperCase())}&name=${encodeURIComponent(name || "")}`;
}

export default function ChipLogo({
  sym,
  company,
  size = 30,
  radius = 7,
}: {
  sym: string;
  company?: string;
  size?: number;
  radius?: number;
}) {
  const [stage, setStage] = useState<"local" | "proxy" | "text">("local");

  if (stage === "text") {
    return (
      <span
        style={{
          width: size, height: size, borderRadius: radius, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: `${HT.cyan}1A`, border: `1px solid ${HT.border}`,
          fontSize: Math.max(9, Math.round(size / 3)), fontWeight: 800,
          color: HT.cyan, textAlign: "center", lineHeight: 1,
        }}
      >
        {sym.slice(0, 4)}
      </span>
    );
  }

  return (
    <span style={{
      width: size, height: size, borderRadius: radius, overflow: "hidden",
      background: "transparent",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <img
        // Remount on stage change so the browser actually re-requests.
        key={stage}
        src={stage === "local" ? localLogoUrl(sym) : proxyLogoUrl(sym, company)}
        alt={sym}
        width={size}
        height={size}
        // Stage 2 is a same-origin URL that 302s to a third-party host, and
        // drawing the result TAINTS a capture canvas — html2canvas cannot tell,
        // because it classifies images by the src string (lib/snapshot.ts
        // gotcha 9). Tagging it lets the snapshot engine swap this chip for its
        // ticker-text form instead of losing the whole PNG to a SecurityError
        // on toBlob(). Stage 1 is a real same-origin file and always draws.
        {...(stage === "proxy" ? { "data-snap-untrusted": "1" } : {})}
        // The chips sit inside a scrolling week strip — most are off-screen at
        // first paint, so let the browser defer them instead of racing them all.
        loading="lazy"
        decoding="async"
        style={{ width: size, height: size, objectFit: "contain" }}
        onError={() => setStage((s) => (s === "local" ? "proxy" : "text"))}
      />
    </span>
  );
}
