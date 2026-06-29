"use client";

import { useState } from "react";
import { saveMVCSnapshot } from "@/lib/snapdb";

declare global {
  interface Window {
    __gexAppState?: {
      chain?: Array<Record<string, number>>;
      spotPrice?: number;
      esPrice?: number;
      expiration?: string;
      gexFlip?: number | null;
    };
  }
}

type BtnState = "idle" | "saving" | "ok" | "err";
type SnapMode = "save" | "share";

function getHighestRow<T extends Record<string, number | undefined>>(
  chain: T[],
  field: string,
): T | null {
  if (!chain.length) return null;
  return chain.reduce((best, row) =>
    Math.abs(Number((row as Record<string, unknown>)[field] ?? 0)) >
    Math.abs(Number((best as Record<string, unknown>)[field] ?? 0))
      ? row
      : best
  , chain[0]);
}

function captureGexCanvas(): string | null {
  try {
    const canvases = document.querySelectorAll<HTMLCanvasElement>("canvas");
    if (!canvases.length) return null;
    let best: HTMLCanvasElement | null = null;
    let bestArea = 0;
    canvases.forEach(c => {
      const area = c.width * c.height;
      if (area > bestArea) { bestArea = area; best = c; }
    });
    if (!best || bestArea < 1000) return null;
    return (best as HTMLCanvasElement).toDataURL("image/png");
  } catch {
    return null;
  }
}

async function sendToDiscord(payload: {
  content: string;
  imageBase64?: string | null;
}): Promise<void> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: payload.content }));

  if (payload.imageBase64) {
    const base64 = payload.imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const bytes  = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const blob   = new Blob([bytes], { type: "image/png" });
    form.append("files[0]", blob, "gex-snap.png");
  }

  const res = await fetch("/api/discord-share", { method: "POST", body: form });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Discord send failed ${res.status}: ${txt}`);
  }
}

function fmtNum(v: number) {
  const a = Math.abs(v);
  const s = v >= 0 ? "+" : "-";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(2)}K`;
  return `${s}$${a.toFixed(0)}`;
}

async function fetchSnapshotData() {
  const res = await fetch("/api/gex");
  if (!res.ok) throw new Error(`GEX fetch failed: ${res.status}`);
  const data = await res.json();

  const chain: Array<Record<string, number>> = data.chain ?? [];
  const spot = data.spotPrice ?? 0;
  const expiry = data.expiration ?? window.__gexAppState?.expiration ?? "—";
  const flipPt = data.gexFlip ?? null;
  const esPrice = window.__gexAppState?.esPrice ?? spot;
  const nearestStrike = spot > 0 ? Math.round(spot / 5) * 5 : null;

  const mvcOIRow = getHighestRow(chain, "netGEX");
  const mvcVolRow = getHighestRow(chain, "netVolGEX");
  const dexRow = getHighestRow(chain, "netDEX");

  const totalNetGEX = chain.reduce((s, r) => s + Number(r.netGEX ?? 0), 0);
  const totalNetGEX_Vol = chain.reduce((s, r) => s + Number(r.netVolGEX ?? 0), 0);
  const totalNetDEX_OI = chain.reduce((s, r) => s + Number(r.netDEX ?? 0), 0);
  const totalNetDEX_Vol = chain.reduce((s, r) => s + Number(r.volNetDEX ?? 0), 0);

  return {
    chain,
    spot,
    expiry,
    flipPt,
    esPrice,
    mvcOIRow,
    mvcVolRow,
    dexRow,
    nearestStrike,
    totalNetGEX,
    totalNetGEX_Vol,
    totalNetDEX_OI,
    totalNetDEX_Vol,
  };
}

export async function saveManualMvcSnapshot(): Promise<void> {
  const snap = await fetchSnapshotData();

  await saveMVCSnapshot({
    mvcOIVol: {
      strike: snap.mvcOIRow?.strike ?? snap.nearestStrike ?? null,
      value: snap.mvcOIRow?.netGEX ?? 0,
      volume: Number(snap.mvcOIRow?.callVolume ?? 0) + Number(snap.mvcOIRow?.putVolume ?? 0),
    },
    mvcVolOnly: {
      strike: snap.mvcVolRow?.strike ?? snap.nearestStrike ?? null,
      value: snap.mvcVolRow?.netVolGEX ?? 0,
      volume: Number(snap.mvcVolRow?.callVolume ?? 0) + Number(snap.mvcVolRow?.putVolume ?? 0),
    },
    spxPrice: snap.spot,
    esPrice: snap.esPrice,
    expiration: snap.expiry,
    triggerType: "manual",
    totalNetGEX: snap.totalNetGEX,
    totalNetGEX_Vol: snap.totalNetGEX_Vol,
    totalNetDEX_OI: snap.totalNetDEX_OI,
    totalNetDEX_Vol: snap.totalNetDEX_Vol,
    netDexStrike: snap.dexRow?.strike ?? snap.nearestStrike ?? null,
    gexFlip: snap.flipPt,
  });

  window.dispatchEvent(new CustomEvent("db-mvc-updated", { detail: { triggerType: "manual" } }));
}

async function shareManualSnapshot(): Promise<void> {
  const snap = await fetchSnapshotData();
  const screenshot = captureGexCanvas();
  const now = new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
  const lines = [
    `📸 **GEX Snap** — ${now} ET`,
    `**SPX** ${snap.spot.toFixed(2)}  |  **Expiry** ${snap.expiry}`,
    `**Net GEX** ${fmtNum(snap.totalNetGEX)}  |  **Γ0** ${snap.flipPt ? snap.flipPt.toFixed(0) : "—"}`,
    snap.mvcOIRow ? `**Peak OI** ${snap.mvcOIRow.strike} (${fmtNum(Number(snap.mvcOIRow.netGEX ?? 0))})` : null,
    snap.mvcVolRow ? `**Peak Vol** ${snap.mvcVolRow.strike} (${fmtNum(Number(snap.mvcVolRow.netVolGEX ?? 0))})` : null,
  ].filter(Boolean).join("\n");

  await sendToDiscord({ content: lines, imageBase64: screenshot });
}

export default function SnapButton({ mode = "save" }: { mode?: SnapMode }) {
  const [state, setState] = useState<BtnState>("idle");
  const isSave = mode === "save";

  async function handleClick() {
    if (state === "saving") return;
    setState("saving");
    try {
      if (mode === "save") await saveManualMvcSnapshot();
      else await shareManualSnapshot();
      setState("ok");
      setTimeout(() => setState("idle"), 1800);
    } catch (e) {
      console.error("[SnapButton]", e);
      setState("err");
      setTimeout(() => setState("idle"), 2000);
    }
  }

  const label =
    state === "saving" ? "..." :
    state === "ok" ? "✓" :
    state === "err" ? "✕" :
    (isSave ? "📸" : "💬");

  const color =
    state === "ok" ? "#00e676" :
    state === "err" ? "#ff4757" :
    (isSave ? "#219EBC" : "#ffb300");

  const borderColor =
    state === "ok" ? "rgba(0,230,118,.35)" :
    state === "err" ? "rgba(255,71,87,.35)" :
    (isSave ? "rgba(33,158,188,.25)" : "rgba(255,179,0,.28)");

  const background = isSave
    ? "linear-gradient(180deg,rgba(33,158,188,.12),rgba(33,158,188,.04))"
    : "linear-gradient(180deg,rgba(255,179,0,.12),rgba(255,179,0,.04))";

  return (
    <button
      onClick={handleClick}
      title={isSave ? "Save CB - Core Bullseye snapshot to the database page" : "Capture the GEX screenshot and send it to Discord"}
      style={{
        fontSize: 13,
        padding: "5px 7px",
        background,
        border: `1px solid ${borderColor}`,
        color,
        borderRadius: 2,
        cursor: state === "saving" ? "default" : "pointer",
        fontFamily: "inherit",
        fontWeight: 700,
        flexShrink: 0,
        letterSpacing: ".08em",
        transition: "color .2s, border-color .2s",
      }}
    >
      {label}
    </button>
  );
}
