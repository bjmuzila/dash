// Owner "Tree" page — project structure / architecture view. Port of
// app/owner/dev/tree/page.tsx. The live filesystem scan is server-only, so the
// data comes from a static snapshot (see ./tree/scan). The nav + data-flow
// visualizations are the radial SVGs in ./tree/FlowDiagram.
import { scanArchitecture } from "./tree/scan";
import FlowDiagram from "./tree/FlowDiagram";

// Budget theme (see BUDGET_UI_STYLE.md): one accent — light blue #7dd3fc — no
// rotating card colors, no top bars; frosted card + faint light-blue radial.
const LIGHT_BLUE = "#7dd3fc";
const C = {
  bg: "#05060A",
  panel: "rgba(13,17,25,0.45)",
  cardBg: "rgba(13,17,25,0.45)",
  line: "rgba(255,255,255,0.10)",
  dim: "rgba(255,255,255,0.50)",
  text: "#FFFFFF",
  accent: LIGHT_BLUE,
};

export default function Tree() {
  const { summary, columns } = scanArchitecture();

  return (
    <div style={{ padding: "24px 28px", color: C.text, minHeight: "100vh", overflow: "auto" }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center",
            background: "linear-gradient(135deg,#6366f1,#a855f7)", fontSize: 14,
          }}
        >
          🌳
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.accent }}>
            Bzila Architecture
          </h1>
          <div style={{ color: C.dim, fontSize: 14 }}>Project Structure Analysis · static snapshot</div>
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
              background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 18,
              padding: "16px 18px",
            }}
          >
            <div style={{ color: C.dim, fontSize: 14, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.accent }}>{s.value}</div>
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
                fontSize: 17, fontWeight: 700, color: C.accent,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 99, background: C.accent }} />
              {col.heading}
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              {col.cards.map((card) => (
                <div
                  key={card.title}
                  style={{
                    background: C.cardBg, border: `1px solid ${C.line}`,
                    borderRadius: 18, padding: "14px 16px",
                  }}
                >
                  <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10, display: "flex", gap: 8 }}>
                    <span>{card.icon}</span>
                    <span style={{ color: C.accent }}>{card.title}</span>
                    <span style={{ marginLeft: "auto", color: C.dim, fontWeight: 400, fontSize: 14 }}>
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
                            fontSize: 14, padding: "3px 8px", borderRadius: 6,
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
                        <div key={f.name} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 14 }}>
                          <span style={{ color: "#9fe7d6", fontFamily: "ui-monospace, monospace" }}>{f.name}</span>
                          {f.desc && <span style={{ color: C.dim, fontSize: 14 }}>· {f.desc}</span>}
                        </div>
                      ))}
                      {card.files.length === 0 && (
                        <span style={{ color: C.dim, fontSize: 14 }}>—</span>
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
