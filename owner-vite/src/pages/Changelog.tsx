import { useEffect, useState } from "react";

/**
 * /changelog — renders CHANGELOG.md. Port of app/changelog/page.tsx.
 * The Next page read the file from disk server-side; here the file is bundled
 * into the app's public/ (a per-build snapshot — current as of each deploy) and
 * fetched at runtime.
 */
export default function Changelog() {
  const [text, setText] = useState<string>("Loading…");

  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}CHANGELOG.md`, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => { if (alive) setText(t); })
      .catch(() => { if (alive) setText("No CHANGELOG.md found."); });
    return () => { alive = false; };
  }, []);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        background: "radial-gradient(circle at top, rgba(33,158,188,0.08), transparent 40%), #05080d",
        padding: "24px 20px",
        color: "#e8edf5",
        fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 12, color: "#FFFFFF", letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 800, marginBottom: 8 }}>
          Live Notes
        </div>
        <h1 style={{ fontSize: 28, lineHeight: 1.1, margin: "0 0 10px", fontWeight: 800 }}>Changelog</h1>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "#FFFFFF" }}>
          This page shows the current contents of <span style={{ color: "#7dd3fc" }}>CHANGELOG.md</span> (bundled per build).
        </p>

        <div
          style={{
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 18,
            background: "radial-gradient(circle at 50% 0%, rgba(126,211,252,0.10) 0%, transparent 60%), rgba(13,17,25,0.45)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#FFFFFF" }}>Source File</span>
            <span style={{ fontSize: 12, color: "#7dd3fc", fontWeight: 700 }}>CHANGELOG.md</span>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 16,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflowX: "auto",
              fontSize: 14,
              lineHeight: 1.65,
              color: "#e8edf5",
              fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
            }}
          >
            {text}
          </pre>
        </div>
      </div>
    </div>
  );
}
