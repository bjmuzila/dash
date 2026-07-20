"use client";

/**
 * /gex — standalone, full-bleed GEX chart used by the Social Media "Day Posts"
 * visual capture. With ?embed=1 (or ?chartonly=1) it renders ONLY the live
 * net-GEX bars (same <GexChart> component + /api/gex feed as the /home
 * dashboard), no chrome, wrapped in #flow-chart-capture so the Day Posts
 * html2canvas grab picks it up exactly like the Flow / Greeks embeds. Without a
 * param it bounces to / (preserves the prior redirect-only behavior for humans).
 *
 * Reached same-origin from owner.cbedge.net via the owner-vite/nginx.conf proxy
 * (contentDocument capture requires same-origin). GexChart computes GEX from the
 * chain rows itself given spotPrice, and backs its canvas at devicePixelRatio so
 * the screenshot fills the frame.
 */

import { useEffect, useState } from "react";
import GexChart from "@/components/dashboard/GexChart";
import type { ChainRow } from "@/lib/calculations/calculations";

export default function GexPage() {
  const [embed, setEmbed] = useState<boolean | null>(null);
  const [chain, setChain] = useState<ChainRow[]>([]);
  const [spot, setSpot] = useState(0);
  const [flip, setFlip] = useState<number | null>(null);

  // Resolve embed-vs-redirect from the URL (window only — avoids the
  // useSearchParams Suspense requirement) before rendering anything.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const isEmbed = p.has("embed") || p.has("chartonly");
    if (!isEmbed) {
      window.location.replace("/");
      return;
    }
    setEmbed(true);
  }, []);

  useEffect(() => {
    if (!embed) return;
    let alive = true;
    const load = () =>
      fetch("/api/gex", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          if (Array.isArray(d.chain)) setChain(d.chain as ChainRow[]);
          setSpot(Number(d.spotPrice ?? 0));
          setFlip(d.gexFlip ?? null);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [embed]);

  if (!embed) return null;

  return (
    <div
      id="flow-chart-capture"
      style={{ position: "fixed", inset: 0, background: "#05060A" }}
    >
      {chain.length > 0 ? (
        <GexChart
          chain={chain}
          spotPrice={spot}
          flipPoint={flip}
          mode="net"
          dataMode="oi-vol"
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#2a4060",
            font: "bold 13px Arial",
          }}
        >
          Fetching SPX chain…
        </div>
      )}
    </div>
  );
}
