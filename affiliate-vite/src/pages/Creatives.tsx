import { useCallback, useEffect, useState } from "react";
import Shell from "../components/Shell";
import { Banner, Card, ErrorNote, Pill } from "../components/ui";
import { CreativeImage, CREATIVE_W, CREATIVE_H, downloadCreative } from "../components/renders";
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
 * The images are real screenshots served from /creatives/. A slot with no file
 * yet renders as a labelled empty frame and its buttons stay DISABLED — see
 * components/renders.tsx. Sharing a card with no picture is worse than not
 * having the card, so the UI simply won't do it.
 */
export default function Creatives() {
  const { affiliate } = useSession();
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [link, setLink] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [ready, setReady] = useState<Record<string, boolean>>({});
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
  const pending = creatives.filter((c) => ready[c.id] === false).length;

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
        <span style={{ fontSize: TYPE.label, color: THEME.dim }}>Stamped with {code}</span>
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}

      {pending > 0 && (
        <Banner tone="orange">
          <Pill tone="orange">Coming soon</Pill>
          <span>
            {pending === creatives.length ? "These images are" : `${pending} of these images are`} still being put
            together. The copy is ready to use now — grab it, take your own screenshot of the terminal, and post.
            The finished graphics land here shortly.
          </span>
        </Banner>
      )}

      <Banner tone="cyan">
        <Pill tone="cyan">How these work</Pill>
        <span>
          Every image is watermarked with <b style={{ fontFamily: "var(--font-mono)" }}>{code}</b> as you download
          it, so a screenshot of your post still credits you. Edit the copy into your own voice before you send
          it — identical wording across every affiliate reads like a press release.
        </span>
      </Banner>

      {creatives.length === 0 ? (
        <Card><div style={{ color: THEME.dim }}>Creatives unlock once your code is issued.</div></Card>
      ) : (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))" }}>
          {creatives.map((c) => {
            const imgId = `creative-${c.id}`;
            const hasImage = ready[c.id] === true;
            return (
              <div key={c.id} className="card-hover" style={{ ...cardStyle, overflow: "hidden" }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 16px", borderBottom: `1px solid ${THEME.border}`,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: THEME.dim }}>
                    {c.label}
                  </div>
                  <div style={{ marginLeft: "auto" }}>
                    {hasImage ? <Pill tone="grey">{CREATIVE_W} × {CREATIVE_H}</Pill> : <Pill tone="orange">No image yet</Pill>}
                  </div>
                </div>

                <div style={{ borderBottom: `1px solid ${THEME.border}` }}>
                  <CreativeImage
                    src={c.image}
                    code={code}
                    id={imgId}
                    onLoaded={(ok) => setReady((r) => (r[c.id] === ok ? r : { ...r, [c.id]: ok }))}
                  />
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
                    <button
                      style={{ ...buttonStyle, opacity: hasImage ? 1 : 0.45, cursor: hasImage ? "pointer" : "not-allowed" }}
                      disabled={!hasImage}
                      onClick={() => postToX(c.id)}
                    >Post to X</button>
                    {/* Copy stays live for an empty slot — the words are usable
                        with a screenshot the affiliate takes themselves. */}
                    <button style={secondaryButtonStyle} onClick={() => copy(c.id)}>
                      {copied === c.id ? "Copied" : "Copy text"}
                    </button>
                    <button
                      style={{ ...secondaryButtonStyle, opacity: hasImage ? 1 : 0.45, cursor: hasImage ? "pointer" : "not-allowed" }}
                      disabled={!hasImage}
                      onClick={() => downloadCreative(imgId, code, `cbedge-${c.id}-${code}.png`)}
                    >Download PNG</button>
                  </div>
                  <div style={{ fontSize: 11, color: THEME.dim, marginTop: 10, lineHeight: 1.5 }}>
                    {hasImage
                      ? "X won't attach the image for you — download it, then drop it into the composer."
                      : "Copy the text now and pair it with your own screenshot; the finished graphic is on its way."}
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
          <div style={{ color: THEME.dim }}>
            Your referral link, for anything you write yourself:{" "}
            <span style={{ color: THEME.cyan, fontFamily: "var(--font-mono)" }}>{link}</span>
          </div>
        </div>
      </Card>
    </Shell>
  );
}
