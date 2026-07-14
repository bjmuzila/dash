import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Bzila brand colors — update to match your existing palette
        brand: {
          bg: "#0d0d0f",
          surface: "#131316",
          border: "#1e1e24",
          accent: "#00d4aa",
          accentDim: "#00a882",
          red: "#ff4d4f",
          yellow: "#faad14",
          text: "#e8e8ee",
          muted: "#6b6b7a",
        },
        // CB Edge dashboard surface set — mirrors the budget/owner card language
        // (homeTheme.ts + /owner/budget local tokens). Keep hues in sync there.
        cbedge: {
          ink: "#020308",       // page background (deep near-black)
          panel: "#0A0E16",     // solid card fill
          raised: "#0D1119",    // sticky headers / opaque surfaces
          hairline: "rgba(255,255,255,0.08)",
          neon: "#219EBC",      // primary cyan accent
          glow: "#7dd3fc",      // light-blue hero/metric accent
          profit: "#8ECAE6",
          loss: "#EF4444",
        },
      },
      boxShadow: {
        card: "inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.5), 0 16px 40px -12px rgba(0,0,0,0.55)",
        "neon-sm": "0 0 16px rgba(33,158,188,0.22), inset 0 1px 0 rgba(255,255,255,0.06)",
        "glow-blue": "inset 0 1px 0 rgba(255,255,255,0.05), 0 0 28px -8px rgba(125,211,252,0.30), 0 16px 40px -12px rgba(0,0,0,0.55)",
        "inset-field": "inset 0 1px 3px rgba(0,0,0,0.45)",
      },
      backgroundImage: {
        "card-sheen": "linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 34%)",
        "shell-glow":
          "radial-gradient(1100px 520px at 12% -10%, rgba(33,158,188,0.07) 0%, transparent 60%), radial-gradient(900px 460px at 88% 6%, rgba(125,211,252,0.05) 0%, transparent 55%)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
