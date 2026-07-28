// ─────────────────────────────────────────────────────────────────────────────
// /owner/watchlists — static reference tables for every ticker roster in the
// stack. Deliberately NOT wired to any API: this is a snapshot you read, not a
// live view. See pages/watchlists/data.ts for the capture date and the caveat.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { PageShell, Card } from "../components/PageCard";
import { OWNER_THEME as T, homeInputStyle, ownerRgba } from "../lib/theme";
import { WATCHLISTS, TT_PUBLIC_WATCHLISTS, TT_CAPTURED, SNAPSHOT_DATE } from "./watchlists/data";

const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

function tabStyle(active: boolean, accent: string) {
  return {
    padding: "7px 13px",
    borderRadius: 8,
    border: `1px solid ${active ? accent : T.border}`,
    background: active ? ownerRgba(accent, 0.14) : "rgba(255,255,255,0.03)",
    color: active ? accent : T.text,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  };
}

const ACCENTS = [T.cyan, T.orange, T.green, T.gold];

/** Stable accent per list, so a tab's colour does not shift when lists are added. */
function accentFor(id: string): string {
  const i = WATCHLISTS.findIndex((w) => w.id === id);
  return ACCENTS[(i < 0 ? 0 : i) % ACCENTS.length];
}

export default function Watchlists() {
  const [tab, setTab] = useState<string>(WATCHLISTS[0].id);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const active = WATCHLISTS.find((w) => w.id === tab) ?? WATCHLISTS[0];
  const accent = accentFor(active.id);
  const query = q.trim().toUpperCase();

  // Filter within the active list; groups that empty out are dropped entirely
  // so a search never leaves a wall of empty headers.
  const groups = useMemo(
    () =>
      active.groups
        .map((g) => ({ ...g, symbols: g.symbols.filter((s) => !query || s.includes(query)) }))
        .filter((g) => g.symbols.length > 0),
    [active, query],
  );

  const shown = groups.reduce((n, g) => n + g.symbols.length, 0);
  const total = active.groups.reduce((n, g) => n + g.symbols.length, 0);

  const copy = (label: string, syms: string[]) => {
    void navigator.clipboard?.writeText(syms.join(", "));
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1400);
  };

  return (
    <PageShell maxWidth={1240}>
      <div>
        <div style={{ fontSize: 12, color: T.text, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 800, marginBottom: 6 }}>
          Reference
        </div>
        <h1 style={{ fontSize: 28, lineHeight: 1.1, margin: "0 0 8px", fontWeight: 800, color: T.text }}>
          Watchlists
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: T.text, opacity: 0.75 }}>
          Static snapshot captured <span style={{ color: T.lightBlue, fontWeight: 700 }}>{SNAPSHOT_DATE}</span>. Not
          wired to the API — if the server lists change, this page will not update itself.
        </p>
      </div>

      {/* Tabs, split by who owns the list */}
      {(["mine", "tastytrade"] as const).map((owner) => (
        <div key={owner}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: T.text, opacity: 0.5, marginBottom: 7 }}>
            {owner === "mine" ? "CB Edge — server-v2" : "Tastytrade"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {WATCHLISTS.filter((w) => w.owner === owner).map((w) => (
              <button
                key={w.id}
                onClick={() => setTab(w.id)}
                style={tabStyle(w.id === tab, accentFor(w.id))}
              >
                {w.label}
                <span style={{ marginLeft: 7, opacity: 0.65, fontWeight: 700 }}>
                  {w.groups.reduce((n, g) => n + g.symbols.length, 0)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
        {/* Header strip: source path + filter */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
          <div style={{ minWidth: 260, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: T.text, opacity: 0.6 }}>
              Source
            </div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: accent, fontWeight: 700, marginTop: 3 }}>
              {active.source}
            </div>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value.toUpperCase())}
            placeholder="Filter ticker…"
            spellCheck={false}
            autoComplete="off"
            style={{ ...homeInputStyle, width: 200, fontFamily: MONO, fontSize: 13 }}
          />
        </div>

        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, fontSize: 13, color: T.text, opacity: 0.8, lineHeight: 1.6 }}>
          {active.blurb}
        </div>

        {query && (
          <div style={{ padding: "9px 18px", borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.lightBlue, fontWeight: 700 }}>
            {shown} of {total} match “{query}”
          </div>
        )}

        {/* Groups */}
        <div style={{ padding: "4px 0 8px" }}>
          {groups.length === 0 && (
            <div style={{ padding: "26px 18px", fontSize: 13, color: T.text, opacity: 0.55 }}>
              No ticker matches “{query}” in {active.label}.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.id} style={{ padding: "14px 18px", borderTop: `1px solid ${ownerRgba("#ffffff", 0.05)}` }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: accent }}>
                  {g.label}
                </span>
                <span style={{ fontSize: 12, color: T.text, opacity: 0.55, fontWeight: 700 }}>{g.symbols.length}</span>
                <span style={{ fontSize: 12, color: T.text, opacity: 0.55 }}>· {g.note}</span>
                <button
                  onClick={() => copy(g.label, g.symbols)}
                  style={{
                    marginLeft: "auto",
                    padding: "4px 9px",
                    borderRadius: 6,
                    border: `1px solid ${T.border}`,
                    background: "rgba(255,255,255,0.04)",
                    color: copied === g.label ? T.green : T.text,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {copied === g.label ? "Copied" : "Copy"}
                </button>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(74px, 1fr))",
                  gap: 5,
                }}
              >
                {g.symbols.map((s) => (
                  <div
                    key={s}
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      fontWeight: 700,
                      color: T.text,
                      background: T.panelInset,
                      border: `1px solid ${T.border}`,
                      borderRadius: 5,
                      padding: "5px 7px",
                      textAlign: "center",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {s}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Tastytrade catalog — names only */}
      <Card variant="classic" title="Tastytrade public watchlists" subtitle={`${TT_PUBLIC_WATCHLISTS.length} available · ${TT_CAPTURED.length} captured above`}>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: T.text, opacity: 0.75, lineHeight: 1.6 }}>
          Everything tastytrade exposes at <span style={{ fontFamily: MONO, color: T.lightBlue }}>GET /public-watchlists</span>.
          Highlighted names are captured in the tabs above. To pull another, hit{" "}
          <span style={{ fontFamily: MONO, color: T.lightBlue }}>/public-watchlists/&#123;name&#125;</span> with the name
          URL-encoded and the OAuth token as <span style={{ fontFamily: MONO }}>Bearer</span>.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 5 }}>
          {TT_PUBLIC_WATCHLISTS.map((n) => {
            const got = TT_CAPTURED.includes(n);
            return (
              <div
                key={n}
                style={{
                  fontSize: 12,
                  color: got ? T.green : T.text,
                  opacity: got ? 1 : 0.6,
                  fontWeight: got ? 700 : 400,
                  background: got ? ownerRgba(T.green, 0.10) : T.panelInset,
                  border: `1px solid ${got ? ownerRgba(T.green, 0.35) : T.border}`,
                  borderRadius: 5,
                  padding: "6px 9px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={got ? `${n} — captured above` : n}
              >
                {got ? "✓ " : ""}{n}
              </div>
            );
          })}
        </div>
      </Card>
    </PageShell>
  );
}
