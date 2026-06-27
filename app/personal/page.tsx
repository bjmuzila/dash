"use client";

/**
 * Personal — PIN-gated personal hub.
 * Full React port of pages/personal/personal.html from the vanilla site.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const VALID_PINS = ["0312", "9365"];

const CARDS = [
  { section: "budget", icon: "💰", title: "Budget", desc: "Track expenses and manage financial goals", footer: "Coming soon" },
  { section: "todo", icon: "✓", title: "Todo", desc: "Organize tasks and stay on top of priorities", footer: "Click to open →" },
  { section: "trading", icon: "📈", title: "Trading", desc: "Review trading performance and metrics", footer: "Coming soon" },
  { section: "personal-notes", icon: "👤", title: "Personal", desc: "Personal notes and information", footer: "Coming soon" },
];

export default function PersonalPage() {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  // Check PIN once 4 digits entered (matches vanilla 280ms delay)
  useEffect(() => {
    if (pin.length !== 4) return;
    const t = setTimeout(() => {
      if (VALID_PINS.includes(pin)) {
        setUnlocked(true);
        setPin("");
      } else {
        setError(true);
        setPin("");
        setTimeout(() => setError(false), 1500);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [pin]);

  const addDigit = (d: string) => setPin((p) => (p.length >= 4 ? p : p + d));
  const delDigit = () => { setPin((p) => p.slice(0, -1)); setError(false); };

  const openSection = (section: string) => {
    if (section === "todo") router.push("/personal/todo");
  };

  const keyStyle: React.CSSProperties = {
    width: 58, height: 58, background: "#0d1520", border: "1px solid #1e3050",
    borderRadius: 2, color: "#9fb3c8", fontWeight: 600, fontSize: 11,
    textTransform: "uppercase", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "var(--font-inter), 'Inter', sans-serif", transition: "background .12s, color .12s",
  };

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden", background: "#070b11" }}>

      {/* PIN screen */}
      {!unlocked && (
        <div style={{
          position: "absolute", inset: 0, background: "#070b11", zIndex: 100,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 28, alignItems: "center", maxWidth: 300, width: "100%" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#e8edf5", letterSpacing: ".12em", textTransform: "uppercase" }}>
              Enter PIN
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{
                  width: 48, height: 48, background: "#0d1520",
                  border: `1px solid ${i < pin.length ? "#219EBC" : "#1e3050"}`,
                  boxShadow: i < pin.length ? "0 0 8px rgba(33,158,188,.2)" : "none",
                  borderRadius: 2, fontSize: 22, fontWeight: 700, color: "#219EBC",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "monospace", transition: "border-color .2s, box-shadow .2s",
                }}>
                  {i < pin.length ? "●" : ""}
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 58px)", gap: 6 }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button key={n} style={keyStyle} onClick={() => addDigit(String(n))}>{n}</button>
              ))}
              <button style={keyStyle} onClick={() => addDigit("0")}>0</button>
              <button style={keyStyle} onClick={delDigit}>← Del</button>
            </div>
            <div style={{
              color: "#ff5252", fontSize: 11, height: 16,
              opacity: error ? 1 : 0, transition: "opacity .3s", letterSpacing: ".05em",
            }}>
              Incorrect PIN
            </div>
          </div>
        </div>
      )}

      {/* Unlocked content */}
      {unlocked && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          <div style={{
            flexShrink: 0, padding: "10px 20px", borderBottom: "1px solid #1a2a3a",
            background: "#0a0f16", display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: ".12em", color: "#e8edf5", display: "flex", alignItems: "center", gap: 8,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#219EBC" }} />
              Personal
            </div>
            <button
              onClick={() => setUnlocked(false)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 10px", fontFamily: "var(--font-inter), 'Inter', sans-serif", fontSize: 10,
                fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase",
                borderRadius: 2, cursor: "pointer", transition: "all .12s",
                background: "transparent", color: "#9fb3c8", border: "1px solid #1e3050",
              }}
            >
              ⏻ Lock
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
              {CARDS.map((c) => (
                <div
                  key={c.section}
                  onClick={() => openSection(c.section)}
                  onMouseEnter={() => setHover(c.section)}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    background: hover === c.section ? "#0d1520" : "#0a0f16",
                    border: `1px solid ${hover === c.section ? "#1e3050" : "#1a2a3a"}`,
                    borderRadius: 2, padding: 20, cursor: "pointer", transition: "all .18s",
                    transform: hover === c.section ? "translateY(-3px)" : "none",
                    boxShadow: hover === c.section ? "0 8px 24px rgba(0,0,0,.5)" : "none",
                    display: "flex", flexDirection: "column", gap: 10, minHeight: 150,
                  }}
                >
                  <div style={{ fontSize: 24, lineHeight: 1 }}>{c.icon}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#e8edf5" }}>{c.title}</div>
                  <div style={{ fontSize: 11, color: "#9fb3c8", flexGrow: 1, lineHeight: 1.5 }}>{c.desc}</div>
                  <div style={{ fontSize: 10, color: "#5a7a99", textTransform: "uppercase", letterSpacing: ".08em" }}>{c.footer}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
