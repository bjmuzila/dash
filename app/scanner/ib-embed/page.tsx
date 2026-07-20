"use client";

/**
 * /scanner/ib-embed — the live "today" IB card, alone, for iframing.
 *
 * The ES-candles chart's IB dock button pops a hover preview that iframes this
 * route with ?embed=1. LayoutShell strips the global toolbar/nav on embed=1, and
 * <IbStatsTab embedToday /> renders only symTabs + LiveToday (no historical
 * tables, no daily scoreboard, no owner chrome). Result: just today's section.
 *
 * Open the full board with the popup's "Open ↗" link → /scanner?tab=ibstats.
 */

import IbStatsTab from "@/components/scanner/IbStatsTab";
import { HOME_THEME } from "@/components/shared/homeTheme";

export default function IbEmbedPage() {
  return (
    <div style={{ height: "100%", overflow: "auto", padding: 16, background: HOME_THEME.bg }}>
      <IbStatsTab embedToday />
    </div>
  );
}
