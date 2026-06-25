"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    mermaid?: any;
  }
}

// ─── Nav hierarchy (mirror of NAV_GROUPS) ───────────────────────────────────────
const NAV_GRAPH = `
flowchart LR
  HOME(["Home"])

  HOME --> GEX["GEX"]
  HOME --> FUT["Futures"]
  HOME --> STK["Stock Market"]
  HOME --> PER["Personal"]
  HOME --> ADM["Admin"]

  GEX --> g1["Home"]
  GEX --> g3["Multi Greek"]
  GEX --> g4["Options Chain"]
  GEX --> g5["Greeks"]
  GEX --> g6["Confidence"]
  GEX --> g7["EM Front End"]

  FUT --> f1["ES Candles"]
  FUT --> f2["Fails"]

  STK --> s1["Premarket"]
  STK --> s2["Econ Calendar"]

  PER --> p1["Journal"]
  PER --> p2["Budget"]
  PER --> p3["To-Do"]

  ADM --> a1["Owner"]
  ADM --> a2["Admin"]
  ADM --> a3["Tree"]
  ADM --> a4["Database"]
  ADM --> a5["Dev"]
  ADM --> a6["EM BE"]
  ADM --> a7["Social"]
  ADM --> a8["Logs"]
  ADM --> a9["Changelog"]

  classDef root fill:#6366f1,stroke:#a855f7,color:#fff,font-weight:bold;
  classDef grp fill:#0e2a33,stroke:#22d3ee,color:#7fe9f5,font-weight:bold;
  classDef grpdev fill:#2a1530,stroke:#f472b6,color:#f9a8d4,font-weight:bold;
  classDef pg fill:#0b1626,stroke:#2a3b52,color:#cfe0ee;
  class HOME root;
  class GEX,FUT,STK,PER grp;
  class ADM grpdev;
  class g1,g2,g3,g4,g5,g6,g7,f1,f2,s1,s2,p1,p2,p3,a1,a2,a3,a4,a5,a6,a7,a8,a9 pg;
`;

// ─── Data flow (page → upstream sources) ────────────────────────────────────────
const DATA_GRAPH = `
flowchart LR
  WS["WS ws-gex"]
  INS["api insights"]
  GEXA["api gex chains"]
  SNAP["api snapshots"]
  LVL["api levels em"]
  CONF["api confidence"]
  ESA["api es-stats dxlink"]
  CAL["api calendars"]
  BUD["api budget"]
  DB["api db"]
  PROXY["proxy metrics"]
  HOME["home"]
  MG["mult-greek"]
  OC["options-chain"]
  GR["greeks"]
  CS["confidence-score"]
  EM["em"]
  ESC["es-candles"]
  FA["fails"]
  PM["premarket"]
  EC["economic-calendar"]
  BU["budget"]
  TR["trading"]
  DBP["database"]
  OWN["dev-owner"]

  HOME --> WS
  HOME --> INS
  HOME --> LVL
  MG --> GEXA
  MG --> SNAP
  OC --> GEXA
  GR --> INS
  GR --> SNAP
  CS --> CONF
  CS --> SNAP
  EM --> LVL
  ESC --> WS
  ESC --> ESA
  FA --> ESA
  PM --> GEXA
  EC --> CAL
  BU --> BUD
  TR --> SNAP
  DBP --> DB
  OWN --> PROXY

  classDef pg fill:#0b1626,stroke:#22d3ee,color:#cfe0ee;
  classDef api fill:#10231b,stroke:#34d399,color:#a7f3d0;
  classDef ws fill:#231016,stroke:#fb7185,color:#fecdd3;
  class HOME,MG,OC,GR,CS,EM,ESC,FA,PM,EC,BU,TR,DBP,OWN pg;
  class INS,GEXA,SNAP,LVL,CONF,ESA,CAL,BUD,DB,PROXY api;
  class WS ws;
`;

export default function FlowDiagram() {
  const [mode, setMode] = useState<"nav" | "data">("nav");
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // load mermaid from CDN once
  useEffect(() => {
    if (window.mermaid) {
      setReady(true);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
    s.onload = () => {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
        themeVariables: { fontSize: "22px" },
        flowchart: { nodeSpacing: 55, rankSpacing: 70, padding: 16, useMaxWidth: false },
      });
      setReady(true);
    };
    document.body.appendChild(s);
  }, []);

  // (re)render on mode change
  useEffect(() => {
    if (!ready || !ref.current || !window.mermaid) return;
    const src = mode === "nav" ? NAV_GRAPH : DATA_GRAPH;
    ref.current.innerHTML = "";
    const id = "tree-mmd-" + Date.now();
    window.mermaid
      .render(id, src)
      .then(({ svg }: { svg: string }) => {
        if (!ref.current) return;
        // strip mermaid's sizing caps so we control scale ourselves
        svg = svg
          .replace(/max-width:\s*[\d.]+px;?/g, "")
          .replace(/style="[^"]*"/, "")
          .replace(/width="[^"]*"/, "")
          .replace(/height="[^"]*"/, "");
        ref.current.innerHTML = svg;
        applyZoom();
      })
      .catch((e: unknown) => {
        if (ref.current) ref.current.innerHTML = `<pre style="color:#f87171">${String(e)}</pre>`;
      });
  }, [ready, mode]);

  function applyZoom() {
    const svg = ref.current?.querySelector("svg") as SVGSVGElement | null;
    if (!svg || !ref.current) return;
    svg.style.maxWidth = "none";
    if (fit) {
      // scale to fill the container width
      svg.style.width = "100%";
      svg.style.height = "auto";
    } else {
      const vb = svg.viewBox.baseVal;
      const baseW = vb && vb.width ? vb.width : 1200;
      const baseH = vb && vb.height ? vb.height : 800;
      svg.style.width = baseW * zoom + "px";
      svg.style.height = baseH * zoom + "px";
    }
  }

  // re-apply zoom when slider moves
  useEffect(() => {
    applyZoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, fit]);

  const btn = (m: "nav" | "data", label: string) => (
    <button
      onClick={() => setMode(m)}
      style={{
        padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
        border: `1px solid ${mode === m ? "#22d3ee" : "rgba(255,255,255,0.12)"}`,
        background: mode === m ? "rgba(34,211,238,0.12)" : "transparent",
        color: mode === m ? "#22d3ee" : "rgba(255,255,255,0.55)",
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        {btn("nav", "Navigation Flow")}
        {btn("data", "Data Flow")}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <button onClick={() => setFit(true)}
            style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${fit ? "#22d3ee" : "rgba(255,255,255,0.12)"}`,
              background: fit ? "rgba(34,211,238,0.12)" : "transparent",
              color: fit ? "#22d3ee" : "rgba(255,255,255,0.55)" }}>Fit</button>
          <button onClick={() => { setFit(false); setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2))); }}
            style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#9fc", fontSize: 18, cursor: "pointer" }}>−</button>
          <input type="range" min={0.6} max={3} step={0.1} value={zoom}
            onChange={(e) => { setFit(false); setZoom(+e.target.value); }} style={{ width: 140 }} />
          <button onClick={() => { setFit(false); setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2))); }}
            style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#9fc", fontSize: 18, cursor: "pointer" }}>+</button>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, width: 38 }}>{fit ? "fit" : Math.round(zoom * 100) + "%"}</span>
        </div>
      </div>
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 14,
          padding: 18,
          height: "78vh",
          overflow: "auto",
        }}
      >
        {!ready && <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Loading diagram…</div>}
        <div ref={ref} />
      </div>
    </div>
  );
}
