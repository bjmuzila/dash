"use client";

/**
 * ProbeButton — owner-only "+ Probe" action on a GEX scanner card.
 *
 * Records the card's contract into the Options Probe pipeline (/api/watch add),
 * which resolves + snapshots it via /proxy/probe-rest and hands it to the
 * server-side recorder. The tracked row shows up on /owner/probe (full greeks +
 * price charts on /owner/watch). Side is inferred from
 * strike vs spot (above spot = call wall, below = put wall) — the scanner rows
 * carry no side of their own.
 *
 * Renders nothing for non-owners. Same cosmetic owner gate as IbStatsTab: the
 * real gate is server-side in /api/watch.
 */

import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { HOME_THEME } from "@/components/shared/homeTheme";

export function useIsOwner() {
  const { userId, isOwnerClaim } = useAuth();
  return isOwnerClaim || (
    process.env.NEXT_PUBLIC_OWNER_USER_ID ? userId === process.env.NEXT_PUBLIC_OWNER_USER_ID : false
  );
}

type State = "idle" | "busy" | "ok" | "err";

export default function ProbeButton({
  symbol, expiry, strike, spot, compact = false,
}: {
  symbol: string;
  expiry: string;
  strike: number;
  spot: number;
  compact?: boolean;
}) {
  const isOwner = useIsOwner();
  const [state, setState] = useState<State>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  if (!isOwner) return null;

  const side: "C" | "P" = spot > 0 && strike < spot ? "P" : "C";

  const probe = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state === "busy") return;
    setState("busy"); setMsg(null);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          ticker: symbol,
          expiry,
          strike,
          side,
          note: `Probe from GEX scanner · ${symbol} ${strike}${side} ${expiry}`,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      // No addedPrice sent → the route captures the live mark from its immediate
      // probe as the permanent entry basis. Echo it back so the fill is visible.
      const fill = Number(j?.created?.added_price);
      setState("ok");
      setMsg(Number.isFinite(fill) && fill > 0 ? `Probed ${strike}${side} @ ${fill.toFixed(2)}` : `Probed ${strike}${side}`);
    } catch (e: any) {
      setState("err"); setMsg(String(e?.message || e).slice(0, 60));
    }
    setTimeout(() => { setState("idle"); setMsg(null); }, 4000);
  };

  const color =
    state === "ok" ? HOME_THEME.green :
    state === "err" ? HOME_THEME.red :
    HOME_THEME.cyan;

  return (
    <button
      onClick={probe}
      disabled={state === "busy"}
      title={`Owner: probe ${symbol} ${strike}${side} ${expiry} → tracked on /owner/probe`}
      style={{
        marginTop: 8,
        width: "100%",
        padding: compact ? "4px 8px" : "6px 10px",
        borderRadius: 8,
        fontSize: compact ? 11 : 13,
        fontWeight: 800,
        cursor: state === "busy" ? "default" : "pointer",
        border: `1px solid ${color}`,
        background: state === "ok" ? "rgba(6,214,160,0.12)" : state === "err" ? "rgba(239,71,111,0.12)" : "rgba(33,158,188,0.12)",
        color,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {state === "busy" ? "Probing…" : msg ? msg : `+ Probe ${strike}${side} (owner)`}
    </button>
  );
}
