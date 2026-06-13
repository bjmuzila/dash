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
      },
      fontFamily: {
        sans: ["Arial", "Helvetica", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
