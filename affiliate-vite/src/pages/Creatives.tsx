import { useCallback, useEffect, useState } from "react";
import Shell from "../components/Shell";
import { Banner, Card, ErrorNote, Pill } from "../components/ui";
import { RENDERS, downloadSvgPng } from "../components/renders";
import { useSession } from "../App";
import { api, type Creative } from "../lib/api";
import { THEME, TYPE, buttonStyle, cardStyle, secondaryButtonStyle } from "../lib/theme";

/**
 * Ready-to-post creatives.
 *
 * THE JOB HERE IS TO REMOVE A STEP. An affiliate with a decent channel does not
 * lack an audience — they lack a spare twenty minutes to make a graphic. Every
 * card is a finished post: the artwork already carries their code, the copy
 * already carries their link, and "Post to X" opens the composer prefilled.
 *
 * The copy is EDITABLE in place before posting, on purpose. Identical wording
 * across every affiliate reads as a press release and converts like one; the
 * template is a starting point, not a script.
 *
 * Images are generated client-side from inline SVG (see components/renders.tsx)
 * — no screenshot service, no headless browser, no dependency.
 */
export default function Creatives() {
  const { affiliate } = useSession();
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [link, setLink] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await api.creatives();
      setCreatives(j.creatives || []);
      setLink(j.link || "");
      setDrafts(Object.fromEntries((j.creatives || []).map((c) => [c.id, c.text])));
    } catch (e) { setErr(String((e as Error).message || e)); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!affiliate) return null;
  const code = affiliate.code || "";

  const copy = (id: string) => {
    void navigator.clipboard?.writeText(drafts[id] ?? "");
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  };

  const postToX = (id: string) => {
    const url = `https://x.com/intent/post?text=${encodeURIComponent(drafts[id] ?? "")}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Shell wide>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.02em" }}>Creatives</h1>
        <span style={{ fontSize: TYPE.label, color: THEME.dim2 }}>Stamped with {code}</span>
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}

      <Banner tone="cyan">
        <Pill tone="cyan">Read this first</Pill>
        <span>
          Every image is generated in your browser and watermarked with <b style={{ fontFamily: "var(--font-mono)" }}>{code}</b>,
          so a screenshot of your post still credits you. The numbers on them are illustrative examples of the
          layout — never present them as today's live levels. Edit the copy into your own voice before you send it.
        </span>
      </Banner>

      {creatives.length === 0 ? (
        <Card><div style={{ color: THEME.dim2 }}>Creatives unlock once your code is issued.</div></Card>
      ) : (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))" }}>
          {creatives.map((c) => {
            const Render = RENDERS[c.render] || RENDERS.heatmap;
            const svgId = `render-${c.id}`;
            return (
              <div key={c.id} className="card-hover" style={{ ...cardStyle, overflow: "hidden" }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 16px", borderBottom: `1px solid ${THEME.border}`,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: THEME.dim }}>
                    {c.label}
                  </div>
                  <div style={{ marginLeft: "auto" }}><Pill tone="grey">1200 × 675</Pill></div>
                </div>

                <div style={{ background: "#05060A", borderBottom: `1px solid ${THEME.border}` }}>
                  <Render code={code} id={svgId} />
                </div>

                <div style={{ padding: 14 }}>
                  <textarea
                    value={drafts[c.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                    rows={4}
                    style={{
                      width: "100%", fontSize: 13, lineHeight: 1.55, padding: "10px 12px",
                      borderRadius: 8, border: `1px solid ${THEME.border}`, background: "rgba(0,0,0,0.40)",
                      color: THEME.text, outline: "none", resize: "vertical", fontFamily: "inherit",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <button style={buttonStyle} onClick={() => postToX(c.id)}>Post to X</button>
                    <button style={secondaryButtonStyle} onClick={() => copy(c.id)}>
                      {copied === c.id ? "Copied" : "Copy text"}
                    </button>
                    <button style={secondaryButtonStyle} onClick={() => downloadSvgPng(svgId, `cbedge-${c.id}-${code}.png`)}>
                      Download PNG
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: THEME.dim2, marginTop: 10, lineHeight: 1.5 }}>
                    X won't attach the image for you — download it, then drop it into the composer.
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Card title="Rules of the road">
        <div style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 12.5, color: THEME.dim, lineHeight: 1.6 }}>
          <div><b style={{ color: "#fff" }}>Do</b> — show the product, share your own read of the levels, say plainly that you earn a commission.</div>
          <div><b style={{ color: "#fff" }}>Don't</b> — promise returns, post a P&amp;L as if it came from CB Edge, or bid on “CB Edge” in paid search.</div>
          <div><b style={{ color: "#fff" }}>Never</b> — imply you are CB Edge, or run an account that could be mistaken for it.</div>
          <div style={{ color: THEME.dim2 }}>
            Your referral link, for anything you write yourself:{" "}
            <span style={{ color: THEME.cyan, fontFamily: "var(--font-mono)" }}>{link}</span>
          </div>
        </div>
      </Card>
    </Shell>
  );
}
