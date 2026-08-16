/**
 * scannerStyles — the small formatting + table-style helpers shared by the
 * scanner-family tabs.
 *
 * Extracted from components/pages/Scanner.tsx when GEX Scanner and Market
 * Quality moved to the Test Lab page (2026-08-16). Both pages' tabs still want
 * the same `th`/`td`/`seg()` look and the same number formatting, so the
 * helpers live here rather than being duplicated per file.
 *
 * Plain module — no "use client", no JSX — so importing it costs nothing.
 */

import type { CSSProperties } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";

export const NEUTRAL = "#6B7280";

export const fmtB = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "+";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
};

export const fmtInt = (n: number) => Math.round(n).toLocaleString();
export const fmtChg = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()}`;

export const th: CSSProperties = { padding: "6px 10px", textAlign: "right", fontWeight: 700, letterSpacing: "0.05em" };
export const td: CSSProperties = { padding: "6px 10px", textAlign: "right", color: HOME_THEME.text };

export const seg = (active: boolean): CSSProperties => ({
  padding: "6px 14px", borderRadius: 8, fontSize: 14, cursor: "pointer", fontWeight: 700,
  border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
  background: active ? "rgba(33,158,188,0.15)" : "transparent",
  color: active ? HOME_THEME.text : "rgba(255,255,255,0.7)",
});

export const zColor = (z: number | null) =>
  z == null ? "rgba(255,255,255,0.4)"
  : Math.abs(z) >= 3 ? HOME_THEME.red
  : Math.abs(z) >= 2 ? HOME_THEME.orange
  : HOME_THEME.text;
