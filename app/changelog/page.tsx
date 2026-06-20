import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadChangelog() {
  try {
    const filePath = path.join(process.cwd(), "CHANGELOG.md");
    return await readFile(filePath, "utf8");
  } catch {
    return "No CHANGELOG.md found at the project root.";
  }
}

export default async function ChangelogPage() {
  const changelog = await loadChangelog();

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        background: "radial-gradient(circle at top, rgba(0,229,255,0.08), transparent 40%), #05080d",
        padding: "24px 20px",
        color: "#e8edf5",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 11, color: "#6d87a1", letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 800, marginBottom: 8 }}>
          Live Notes
        </div>
        <h1 style={{ fontSize: 28, lineHeight: 1.1, margin: "0 0 10px", fontWeight: 800 }}>
          Changelog
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "#8da8c2" }}>
          This page shows the current contents of <span style={{ color: "#00e5ff" }}>CHANGELOG.md</span> directly.
          When that file changes, this page reflects it on the next load.
        </p>

        <div
          style={{
            border: "1px solid rgba(0,229,255,0.16)",
            borderRadius: 16,
            background: "rgba(13,17,25,0.72)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#6d87a1" }}>
              Source File
            </span>
            <span style={{ fontSize: 12, color: "#00e5ff", fontWeight: 700 }}>
              CHANGELOG.md
            </span>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 16,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflowX: "auto",
              fontSize: 13,
              lineHeight: 1.65,
              color: "#e8edf5",
              fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
            }}
          >
            {changelog}
          </pre>
        </div>
      </div>
    </div>
  );
}
