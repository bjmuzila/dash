/**
 * /data-flow · how v3 gets its data.
 *
 * A static page: one diagram, and the few lines needed to read it. Nothing here
 * asks the backend for anything, so this page cannot break when the feed does.
 *
 * The image is imported as a Vite asset on purpose. That ships it hashed under
 * /assets/, which nginx gates with `auth_request` exactly like index.html. A
 * file dropped in public/ would sit at the document root and skip the gate,
 * which is the wrong place for a drawing of the backend.
 *
 * The SVG is what renders: 23KB, and crisp at any zoom, which matters because
 * the diagram is 1480px wide and nobody reads it at page width. The PNG is
 * offered as a download for pasting into a doc and is never fetched unless a
 * visitor asks for it.
 */
import { Card, PageShell } from "../components/PageCard";
import {
  ACCENT_TEXT,
  INK,
  LINE,
  MONO,
  PAPER,
  PAPER_QUIET,
  R_MD,
  R_SM,
  W_MED,
  rgba,
} from "../theme";
import diagramPng from "../assets/2026-09-18-v3-data-flow.png";
import diagramSvg from "../assets/2026-09-18-v3-data-flow.svg";

const ALT =
  "CB Edge v3 data flow: upstream feeds into server-v2, then one WebSocket pushing frames " +
  "and REST pulling history, through the client store and hooks into the board cards.";

/** The three line styles in the drawing, and what each one claims. */
const KEY: { swatch: string; dash?: string; term: string; says: string }[] = [
  {
    swatch: "#2f6bff",
    term: "Solid",
    says: "a frame the server pushes. Nothing on the page asked for it.",
  },
  {
    swatch: "#7fb0ff",
    dash: "6 4",
    term: "Dashed",
    says: "a REST read, used only where there is no push channel.",
  },
  {
    swatch: PAPER_QUIET,
    dash: "2 3",
    term: "Dotted",
    says: "the IndexedDB cache, painted under the first live frame.",
  },
];

/** Where each stage actually lives, for anyone opening the repo next to this. */
const FILES: { path: string; does: string }[] = [
  { path: "data/socket.ts", does: "the one connection, its topics, its backoff" },
  { path: "data/store.ts", does: "last frame per type, coalesced into one rAF" },
  { path: "data/cache.ts", does: "IndexedDB, painted under the first live frame" },
  { path: "data/hooks.ts", does: "useFrame and useField, the only door in" },
  { path: "data/api.ts", does: "query, useQuery, preload, poll" },
  { path: "data/dedupeFetch.ts", does: "identical in-flight GETs collapsed into one" },
  { path: "data/liveGex.ts", does: "SPX GEX off three frames, levels derived here" },
  { path: "data/esCandles.ts", does: "history pulled once, the forming bar pushed" },
];

export default function DataFlow() {
  return (
    <PageShell
      title="Data flow"
      lede="Every path a number takes to reach a card in v3: the upstream feeds, server-v2, the one socket, the store, and the two hooks every page reads through."
      maxWidth={1440}
    >
      <Card padding={14} style={{ background: INK }}>
        <a
          href={diagramSvg}
          target="_blank"
          rel="noreferrer"
          style={{ display: "block", borderRadius: R_MD, overflow: "hidden" }}
        >
          <img
            src={diagramSvg}
            alt={ALT}
            style={{ display: "block", width: "100%", height: "auto" }}
          />
        </a>
      </Card>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          margin: "12px 2px 0",
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.06em",
        }}
      >
        <a href={diagramSvg} target="_blank" rel="noreferrer" style={linkStyle}>
          Open full size
        </a>
        <span style={{ color: PAPER_QUIET }}>·</span>
        <a href={diagramPng} download style={linkStyle}>
          Download PNG
        </a>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 22 }}>
        <Card
          title="Reading it"
          subtitle="Three line styles, one claim each."
          style={{ flex: "1 1 420px" }}
        >
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
            {KEY.map((k) => (
              <li key={k.term} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                <svg width="30" height="10" aria-hidden style={{ flex: "0 0 auto" }}>
                  <line
                    x1="1"
                    y1="5"
                    x2="29"
                    y2="5"
                    stroke={k.swatch}
                    strokeWidth="2.4"
                    strokeDasharray={k.dash}
                  />
                </svg>
                <span style={{ fontSize: 13.5, color: PAPER }}>
                  <span style={{ fontFamily: MONO, fontWeight: W_MED }}>{k.term}</span>
                  <span style={{ color: PAPER_QUIET }}>: {k.says}</span>
                </span>
              </li>
            ))}
          </ul>
          <p style={{ margin: "16px 0 0", fontSize: 13.5, color: PAPER_QUIET }}>
            The shape of the whole thing is one rule: the server tells the client when something
            changed, and the client only asks when there is nothing to tell it. SPX GEX makes zero
            REST calls. The ETF candle poll runs at 60s because the recorder behind it writes once a
            minute, so a faster poll would re-read bars that did not move.
          </p>
        </Card>

        <Card
          title="Where it lives"
          subtitle="cbedge-v3/src/"
          style={{ flex: "1 1 420px" }}
        >
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 9 }}>
            {FILES.map((f) => (
              <li key={f.path} style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
                <code
                  style={{
                    fontFamily: MONO,
                    fontSize: 11.5,
                    fontWeight: W_MED,
                    color: PAPER,
                    background: rgba("#2f6bff", 0.1),
                    border: `1px solid ${LINE}`,
                    borderRadius: R_SM,
                    padding: "2px 7px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.path}
                </code>
                <span style={{ fontSize: 13, color: PAPER_QUIET, flex: "1 1 200px" }}>{f.does}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </PageShell>
  );
}

const linkStyle = {
  color: ACCENT_TEXT,
  textDecoration: "none",
  borderBottom: `1px solid ${rgba("#6aa0ff", 0.4)}`,
  paddingBottom: 1,
} as const;
