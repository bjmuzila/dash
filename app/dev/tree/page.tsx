import { scanArchitecture } from "./scan";
import FlowDiagram from "./FlowDiagram";

// Read the filesystem on every request so the view stays in sync.
export const dynamic = "force-dynamic";

const C = {
  bg: "#0b1220",
  panel: "rgba(255,255,255,0.03)",
  line: "rgba(255,255,255,0.10)",
  dim: "rgba(255,255,255,0.50)",
  text: "#dce6ee",
};

export default function TreePage() {
  const { summary, columns } = scanArchitecture();

  return (
    <div style={{ padding: "24px 28px", color: C.text, minHeight: "100vh" }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center",
            background: "linear-gradient(135deg,#6366f1,#a855f7)", fontSize: 22,
          }}
        >
          🌳
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#c4b5fd" }}>
            Bzila Architecture
          </h1>
          <div style={{ color: C.dim, fontSize: 13 }}>Project Structure Analysis · live scan</div>
        </div>
      </div>

      {/* ── Flow diagram ── */}
      <div style={{ marginBottom: 28 }}>
        <FlowDiagram />
      </div>

      {/* ── Summary cards ── */}
      <div
        style={{
          display: "grid", gap: 14, marginBottom: 26,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        }}
      >
        {summary.map((s) => (
          <div
            key={s.label}
            style={{
              background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14,
              padding: "16px 18px", borderTop: `2px solid ${s.accent}`,
            }}
          >
            <div style={{ color: C.dim, fontSize: 12, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.accent }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Columns ── */}
      <div
        style={{
          display: "grid", gap: 18,
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          alignItems: "start",
        }}
      >
        {columns.map((col) => (
          <div key={col.heading}>
            <div
              style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
                fontSize: 15, fontWeight: 700, color: col.accent,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 99, background: col.accent }} />
              {col.heading}
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              {col.cards.map((card) => (
                <div
                  key={card.title}
                  style={{
                    background: C.panel, border: `1px solid ${C.line}`,
                    borderRadius: 14, padding: "14px 16px",
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, display: "flex", gap: 8 }}>
                    <span>{card.icon}</span>
                    <span style={{ color: col.accent }}>{card.title}</span>
                    <span style={{ marginLeft: "auto", color: C.dim, fontWeight: 400, fontSize: 12 }}>
                      {card.files.length}
                    </span>
                  </div>

                  {/* dependency-style chips when no descriptions, else file rows */}
                  {card.files.every((f) => !f.desc) && card.files.length > 4 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {card.files.map((f) => (
                        <span
                          key={f.name}
                          style={{
                            fontSize: 11.5, padding: "3px 8px", borderRadius: 6,
                            background: "rgba(255,255,255,0.05)", color: "#bcd",
                            fontFamily: "ui-monospace, monospace",
                          }}
                        >
                          {f.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 5 }}>
                      {card.files.map((f) => (
                        <div key={f.name} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5 }}>
                          <span style={{ color: "#9fe7d6", fontFamily: "ui-monospace, monospace" }}>{f.name}</span>
                          {f.desc && <span style={{ color: C.dim, fontSize: 11.5 }}>· {f.desc}</span>}
                        </div>
                      ))}
                      {card.files.length === 0 && (
                        <span style={{ color: C.dim, fontSize: 12 }}>—</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
