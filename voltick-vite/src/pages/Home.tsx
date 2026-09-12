/**
 * The contents board. Everything on this site is reachable from here, and the
 * list comes from lib/nav.ts, so a page that exists but is not listed is not a
 * thing that can happen.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ACCENT,
  ACCENT_TEXT,
  GOOD,
  LINE,
  MONO,
  PAPER,
  PAPER_DISPLAY,
  PAPER_QUIET,
  R_LG,
  R_PILL,
  W_BOLD,
  W_MED,
  rgba,
} from "../theme";
import { PageShell } from "../components/PageCard";
import { VOLTICK_SECTIONS } from "../lib/nav";
import type { VoltickStatus } from "../lib/nav";

export default function Home() {
  return (
    <PageShell
      title="Voltick · CB Edge"
      lede={
        <>
          A sandbox for the merger. Nothing here is live to customers and nothing here is load bearing:
          it is where the two products get put beside each other, argued about, and cut down to one. Pages
          are added to the list below as they are built.
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        {VOLTICK_SECTIONS.map((group) => (
          <section key={group.title}>
            <div style={{ marginBottom: 12 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontWeight: W_BOLD,
                  letterSpacing: "-0.005em",
                  color: PAPER_DISPLAY,
                }}
              >
                {group.title}
              </h2>
              <p style={{ margin: "5px 0 0", fontSize: 13, color: PAPER_QUIET, maxWidth: 640 }}>
                {group.blurb}
              </p>
            </div>

            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              }}
            >
              {group.items.map((item) => {
                const inner = (
                  <>
                    <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 15, fontWeight: W_MED, color: PAPER }}>{item.label}</span>
                      <StatusTag status={item.status} />
                    </span>
                    <span style={{ fontSize: 13, color: PAPER_QUIET }}>{item.note}</span>
                    <span
                      style={{
                        marginTop: "auto",
                        paddingTop: 8,
                        fontFamily: MONO,
                        fontSize: 11,
                        letterSpacing: "0.04em",
                        color: ACCENT_TEXT,
                      }}
                    >
                      {item.path}
                      {item.external ? " ↗" : ""}
                    </span>
                  </>
                );
                const rowStyle = {
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  height: "100%",
                  minHeight: 44,
                  padding: "14px 16px",
                  borderRadius: R_LG,
                  color: PAPER,
                } as const;

                return (
                  <li key={item.path}>
                    {/* An external path is served by nginx, not by this SPA, so
                        it has to be a real navigation. A client-side Link would
                        route it internally and land on NotFound. */}
                    {item.external ? (
                      <a href={item.path} className="vk-row" style={rowStyle}>
                        {inner}
                      </a>
                    ) : (
                      <Link to={item.path} className="vk-row" style={rowStyle}>
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div
        style={{
          marginTop: 38,
          paddingTop: 16,
          borderTop: `1px solid ${LINE}`,
          fontSize: 13,
          color: PAPER_QUIET,
          maxWidth: 720,
        }}
      >
        To add a page: an entry in <Code>src/lib/nav.ts</Code>, then the same key in{" "}
        <Code>src/pages/registry.ts</Code> pointing at a <Code>lazy()</Code> import. Until the second edit
        lands the route renders a placeholder, which is the correct state for something planned and not yet
        written.
      </div>
    </PageShell>
  );
}

function StatusTag({ status }: { status: VoltickStatus }) {
  const live = status === "live";
  // GOOD is a data colour and never UI chrome, so "live" here is stated with
  // Volt Blue chrome and a Paper word, not with green.
  const colour = live ? ACCENT_TEXT : PAPER_QUIET;
  const ring = live ? rgba(ACCENT, 0.5) : LINE;
  void GOOD;
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: colour,
        border: `1px solid ${ring}`,
        borderRadius: R_PILL,
        padding: "2px 8px",
      }}
    >
      {live ? "Built" : "Planned"}
    </span>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code
      style={{
        fontFamily: MONO,
        fontSize: 12,
        color: PAPER,
        background: rgba(ACCENT, 0.1),
        border: `1px solid ${LINE}`,
        borderRadius: 6,
        padding: "1px 6px",
      }}
    >
      {children}
    </code>
  );
}
