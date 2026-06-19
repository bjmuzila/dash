"use client";

import { HOME_THEME as T } from "@/components/shared/homeTheme";

// Purely decorative, static representation of the dashboard. Rendered blurred
// behind the landing overlay so visitors get a sense of the product without any
// real data, auth, or network calls.

const panel: React.CSSProperties = {
  background: T.panelBg,
  border: `1px solid ${T.border}`,
  borderRadius: 14,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  overflow: "hidden",
};

function Bar({ w, c }: { w: string; c: string }) {
  return <div style={{ height: 8, width: w, borderRadius: 4, background: c, opacity: 0.85 }} />;
}

function FakeChart() {
  const pts = [40, 55, 48, 70, 62, 85, 78, 95, 88, 110, 100, 120];
  const max = 130;
  return (
    <svg viewBox="0 0 320 120" preserveAspectRatio="none" style={{ width: "100%", height: 120 }}>
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={T.cyan} stopOpacity="0.5" />
          <stop offset="100%" stopColor={T.cyan} stopOpacity="0" />
        </linearGradient>
      </defs>
      {pts.map((p, i) => {
        const x = (i / (pts.length - 1)) * 320;
        const h = (p / max) * 120;
        return (
          <rect
            key={i}
            x={x - 8}
            y={120 - h}
            width={14}
            height={h}
            rx={2}
            fill={i % 3 === 0 ? T.purple : T.cyan}
            opacity={0.55}
          />
        );
      })}
      <polyline
        points={pts.map((p, i) => `${(i / (pts.length - 1)) * 320},${120 - (p / max) * 110}`).join(" ")}
        fill="none"
        stroke={T.orange}
        strokeWidth={2.5}
      />
    </svg>
  );
}

function FakeHeatmap() {
  const rows = 7;
  const cols = 6;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4 }}>
      {Array.from({ length: rows * cols }).map((_, i) => {
        const pos = (i * 37) % 100 > 50;
        const intensity = ((i * 53) % 100) / 130;
        return (
          <div
            key={i}
            style={{
              height: 22,
              borderRadius: 3,
              background: pos
                ? `rgba(32,178,220,${0.15 + intensity})`
                : `rgba(220,50,60,${0.15 + intensity})`,
            }}
          />
        );
      })}
    </div>
  );
}

export default function DashboardMock() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: T.bg,
        backgroundImage: T.shellGlow,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      aria-hidden
    >
      {/* top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 20px",
          borderBottom: `1px solid ${T.border}`,
          background: T.panelBg,
        }}
      >
        <Bar w="120px" c={T.cyan} />
        <div style={{ flex: 1 }} />
        {["SPX", "ES", "VIX", "QQQ"].map((s) => (
          <div key={s} style={{ display: "flex", flexDirection: "column", gap: 5, width: 70 }}>
            <Bar w="40px" c={T.muted} />
            <Bar w="60px" c={T.green} />
          </div>
        ))}
      </div>

      {/* body */}
      <div style={{ flex: 1, display: "flex", gap: 14, padding: 16, minHeight: 0 }}>
        {/* sidebar */}
        <div style={{ width: 64, ...panel, alignItems: "center", padding: 12, gap: 16 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: i === 0 ? "rgba(0,240,255,0.15)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${i === 0 ? "rgba(0,240,255,0.4)" : T.border}`,
              }}
            />
          ))}
        </div>

        {/* main grid */}
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr",
            gridTemplateRows: "1.3fr 1fr",
            gap: 14,
            minHeight: 0,
          }}
        >
          <div style={panel}>
            <Bar w="140px" c={T.text} />
            <FakeChart />
          </div>
          <div style={panel}>
            <Bar w="100px" c={T.text} />
            <FakeHeatmap />
          </div>
          <div style={panel}>
            <Bar w="120px" c={T.text} />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Bar w="40px" c={i % 2 ? T.green : T.red} />
                <Bar w={`${50 + (i * 17) % 40}%`} c={T.muted} />
              </div>
            ))}
          </div>
          <div style={panel}>
            <Bar w="90px" c={T.text} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Bar w="60%" c={T.muted} />
                  <Bar w="90%" c={i % 2 ? T.cyan : T.purple} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
