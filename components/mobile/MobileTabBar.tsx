"use client";

import { useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { TabIcon } from "./MobileIcons";
import {
  MOBILE_TABS,
  MOBILE_TO_DESKTOP,
  normalizeMobilePath,
  setDesktopForced,
  type MobileTab,
} from "./mobileNav";
import { M_COLOR, RADIUS, SAFE_BOTTOM, TAP, TYPE, noTapHighlight, rgba } from "./mobileTheme";

/**
 * MobileTabBar — the fixed bottom tab bar, and the only navigation between the
 * six phone pages.
 *
 * WHY BOTTOM, NOT TOP
 * -------------------
 * The universal toolbar (GlobalToolbar) stays pinned at the top and keeps its
 * job: identity, live ticker, clock, alerts, account. It is NOT a good place
 * for six tab targets on a 6.1" phone — the top third of the screen is the
 * hardest area to reach one-handed, and the toolbar is already fighting for
 * width up there. Tabs go where the thumb is.
 *
 * The bar itself is a translucent blurred slab (iOS tab-bar language) with the
 * home-indicator inset added as padding rather than height, so the glyphs stay
 * vertically centred in the tappable area on both notched and flat devices.
 *
 * Every target is >= 44px tall (TAP.min). Six tabs at 390px gives 65px each,
 * comfortably past the horizontal minimum too.
 */

function TabButton({ tab, active }: { tab: MobileTab; active: boolean }) {
  return (
    <Link
      href={tab.path}
      prefetch={false}
      aria-label={tab.title}
      aria-current={active ? "page" : undefined}
      style={{
        ...noTapHighlight,
        flex: 1,
        minWidth: 0,
        height: TAP.tabBar,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        textDecoration: "none",
        position: "relative",
        color: active ? tab.accent : M_COLOR.faint,
        transition: "color 0.16s ease",
      }}
    >
      {/* Active pill.
          It used to be a 46x28 box pinned over the GLYPH ONLY, which left the
          label hanging outside the highlight — the tab read as an icon button
          with a caption stranded under it rather than as one target. It now
          insets the whole cell, so icon and label are both inside it and the
          word is centred in the button it belongs to. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 3,
          bottom: 3,
          left: 4,
          right: 4,
          borderRadius: RADIUS.sm,
          background: active ? rgba(tab.accent, 0.16) : "transparent",
          boxShadow: active ? `inset 0 0 0 1px ${rgba(tab.accent, 0.34)}` : "none",
          transition: "background 0.16s ease, box-shadow 0.16s ease",
          pointerEvents: "none",
        }}
      />
      <span
        style={{
          position: "relative",
          display: "flex",
          height: 22,
          width: "100%",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <TabIcon name={tab.icon} size={21} />
      </span>
      {/* display:block + width:100% + text-align:center — as an INLINE span the
          overflow/text-overflow below are inert (they don't apply to
          non-replaced inline boxes) and the glyph's optical centre, not the
          cell's, is what the word lined up against. */}
      <span
        style={{
          position: "relative",
          display: "block",
          width: "100%",
          textAlign: "center",
          fontSize: TYPE.micro - 1,
          fontWeight: active ? 800 : 600,
          letterSpacing: "0.02em",
          lineHeight: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {tab.label}
      </span>
    </Link>
  );
}

export default function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const here = normalizeMobilePath(pathname);
  const activeId = MOBILE_TABS.find((t) => here === t.path || here.startsWith(t.path + "/"))?.id;

  // "Desktop site" — long-press any tab. Sets the session opt-out so the phone
  // redirect stops firing, then goes to this tab's full desktop page. A visible
  // button would cost a seventh slot in a row that is already at six.
  const onLongPress = useCallback(() => {
    const target = MOBILE_TO_DESKTOP[here] ?? "/home";
    setDesktopForced(true);
    router.push(target);
  }, [here, router]);

  return (
    <nav
      aria-label="Mobile sections"
      onContextMenu={(e) => {
        // iOS fires contextmenu on long-press; suppress the callout and use it.
        e.preventDefault();
        onLongPress();
      }}
      style={{
        flexShrink: 0,
        position: "relative",
        zIndex: 40,
        paddingBottom: SAFE_BOTTOM,
        background: "rgba(8,11,17,0.92)",
        backdropFilter: "blur(22px) saturate(1.2)",
        WebkitBackdropFilter: "blur(22px) saturate(1.2)",
        borderTop: `1px solid ${M_COLOR.border}`,
        boxShadow: "0 -10px 28px -18px rgba(0,0,0,0.95)",
      }}
    >
      {/* Hairline accent above the bar, mirroring the toolbar's top accent. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${rgba(M_COLOR.cyan, 0.5)} 50%, transparent)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "stretch", padding: "0 2px" }}>
        {MOBILE_TABS.map((t) => (
          <TabButton key={t.id} tab={t} active={t.id === activeId} />
        ))}
      </div>
    </nav>
  );
}
