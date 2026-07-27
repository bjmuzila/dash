"use client";

import { useEffect, useRef, useState } from "react";
import { HOME_THEME, DOCK_THEME, LIGHT_BLUE, homeInputStyle } from "@/components/shared/homeTheme";
import { TICKER_LISTS, type TickerList } from "./tickers";
import { useTicker } from "./tickerContext";

const LIST_KEYS = Object.keys(TICKER_LISTS) as TickerList[];

/**
 * The page's ticker dropdown. Inside it, top-left, sits a second small dropdown
 * that switches which list you're picking from (Favorites / Watchlist).
 */
export default function TickerSelect() {
  const { ticker, name, list, setTicker, setList } = useTicker();
  const [open, setOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setListOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setListOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = TICKER_LISTS[list].items.filter((t) => {
    const s = q.trim().toUpperCase();
    if (!s) return true;
    return t.symbol.includes(s) || t.name.toUpperCase().includes(s);
  });

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", maxWidth: 380 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "10px 14px",
          background: DOCK_THEME.bg,
          border: `1px solid ${open ? LIGHT_BLUE : HOME_THEME.border}`,
          borderRadius: 10,
          color: HOME_THEME.text,
          cursor: "pointer",
          textAlign: "left",
          boxShadow: open ? DOCK_THEME.activeGlow : undefined,
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.06em", color: LIGHT_BLUE }}>{ticker}</span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            color: HOME_THEME.text,
            opacity: 0.6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span style={{ fontSize: 10, color: HOME_THEME.text, opacity: 0.6 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 40,
            top: "calc(100% + 6px)",
            left: 0,
            width: "100%",
            background: DOCK_THEME.bg,
            border: `1px solid ${HOME_THEME.border}`,
            borderTop: `2px solid ${DOCK_THEME.cyanTop}`,
            borderRadius: 10,
            boxShadow: DOCK_THEME.shadow,
          }}
        >
          {/* top-left sub-dropdown — which list */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderBottom: `1px solid ${HOME_THEME.border}` }}>
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setListOpen((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  background: DOCK_THEME.activeTile,
                  border: `1px solid ${DOCK_THEME.activeBorder}`,
                  borderRadius: 6,
                  color: LIGHT_BLUE,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {TICKER_LISTS[list].label}
                <span style={{ fontSize: 8 }}>▼</span>
              </button>
              {listOpen && (
                <div
                  style={{
                    position: "absolute",
                    zIndex: 50,
                    top: "calc(100% + 4px)",
                    left: 0,
                    minWidth: 160,
                    background: DOCK_THEME.bg,
                    border: `1px solid ${HOME_THEME.border}`,
                    borderRadius: 6,
                    boxShadow: DOCK_THEME.shadow,
                    overflow: "hidden",
                  }}
                >
                  {LIST_KEYS.map((k) => (
                    <button
                      key={k}
                      onClick={() => {
                        setList(k);
                        setListOpen(false);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 12px",
                        background: k === list ? DOCK_THEME.activeTile : "transparent",
                        border: "none",
                        borderBottom: `1px solid ${HOME_THEME.border}`,
                        color: k === list ? LIGHT_BLUE : HOME_THEME.text,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      {TICKER_LISTS[k].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              style={{ ...homeInputStyle, flex: 1, minWidth: 0, fontSize: 12, padding: "6px 10px" }}
            />
          </div>

          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {items.length === 0 && (
              <div style={{ padding: 14, fontSize: 12, color: HOME_THEME.text, opacity: 0.6 }}>
                No matches in {TICKER_LISTS[list].label}.
              </div>
            )}
            {items.map((t) => (
              <button
                key={t.symbol}
                onClick={() => {
                  setTicker(t.symbol);
                  setOpen(false);
                  setListOpen(false);
                  setQ("");
                }}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  width: "100%",
                  padding: "9px 14px",
                  background: t.symbol === ticker ? DOCK_THEME.activeTile : "transparent",
                  border: "none",
                  borderBottom: `1px solid ${HOME_THEME.border}`,
                  color: HOME_THEME.text,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    color: t.symbol === ticker ? LIGHT_BLUE : HOME_THEME.text,
                    minWidth: 56,
                  }}
                >
                  {t.symbol}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: HOME_THEME.text,
                    opacity: 0.6,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
