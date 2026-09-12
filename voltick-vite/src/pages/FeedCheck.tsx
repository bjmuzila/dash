/**
 * Feed check. The reverse proxy in nginx.conf is the one thing about this
 * subdomain that can be silently wrong: an unproxied path falls through to
 * try_files and comes back as index.html, so a fetch gets a page of HTML with a
 * 200 on it rather than a 404. This page calls the backend and says exactly
 * what came back, so that failure shows here first instead of inside a feature.
 *
 * READ ONLY. It touches /proxy/health, /proxy/self-metrics and /api/auth/me,
 * and it opens /ws/gex with a narrow topic list. It writes nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACCENT,
  ACCENT_TEXT,
  BAD,
  GOOD,
  LINE,
  MONO,
  PAPER,
  PAPER_QUIET,
  R_MD,
  R_PILL,
  W_MED,
  rgba,
} from "../theme";
import { Card, PageShell } from "../components/PageCard";

type Probe = {
  path: string;
  what: string;
  state: "idle" | "running" | "ok" | "html" | "fail";
  detail: string;
};

const PROBES: { path: string; what: string }[] = [
  { path: "/proxy/health", what: "The dashboard container is up and answering." },
  { path: "/proxy/self-metrics", what: "Socket client count and egress by frame type." },
  { path: "/api/auth/me", what: "Whether a CB Edge session cookie reaches the backend from this subdomain." },
];

// Declared at module scope: the value keys the subscription effect. Scalars are
// not implied by anything, so they are listed explicitly or the socket drops
// them.
const WS_TOPICS = "spot,status";

export default function FeedCheck() {
  const [probes, setProbes] = useState<Probe[]>(
    PROBES.map((p) => ({ ...p, state: "idle", detail: "Not run yet." }))
  );
  const [ws, setWs] = useState<{ state: string; detail: string }>({
    state: "idle",
    detail: "Not connected.",
  });
  const sockRef = useRef<WebSocket | null>(null);

  const run = useCallback(async () => {
    setProbes((rows) => rows.map((r) => ({ ...r, state: "running", detail: "Calling…" })));
    const next = await Promise.all(
      PROBES.map(async ({ path, what }): Promise<Probe> => {
        try {
          const res = await fetch(path, { cache: "no-store", credentials: "include" });
          const ct = res.headers.get("content-type") || "";
          const body = await res.text();
          if (ct.includes("text/html")) {
            return {
              path,
              what,
              state: "html",
              detail: `${res.status} but content-type is text/html. nginx is not proxying this path: it fell through to the SPA fallback.`,
            };
          }
          const trimmed = body.length > 400 ? `${body.slice(0, 400)}…` : body;
          return {
            path,
            what,
            state: res.ok ? "ok" : "fail",
            detail: `${res.status} · ${ct || "no content-type"} · ${trimmed || "(empty body)"}`,
          };
        } catch (err) {
          return { path, what, state: "fail", detail: `Request failed: ${String(err)}` };
        }
      })
    );
    setProbes(next);
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  useEffect(() => {
    return () => {
      sockRef.current?.close();
      sockRef.current = null;
    };
  }, []);

  const connect = useCallback(() => {
    sockRef.current?.close();
    setWs({ state: "opening", detail: "Upgrading…" });
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/ws/gex?topics=${WS_TOPICS}`;
    let frames = 0;
    let opened = 0;
    try {
      const sock = new WebSocket(url);
      sockRef.current = sock;
      sock.onopen = () => {
        opened = Date.now();
        setWs({ state: "open", detail: `Upgraded. Listening on topics ${WS_TOPICS}.` });
      };
      sock.onmessage = () => {
        frames += 1;
        setWs({ state: "open", detail: `${frames} frame${frames === 1 ? "" : "s"} received.` });
      };
      sock.onerror = () => {
        setWs({ state: "fail", detail: "Socket error. The /ws location is not reaching the backend." });
      };
      sock.onclose = (e) => {
        const alive = opened ? Date.now() - opened : 0;
        // 101 then an immediate close is the signature of something else
        // owning the upgrade event on the origin. See AGENTS.md.
        const quick = opened && alive < 3000;
        setWs({
          state: opened ? (quick ? "fail" : "closed") : "fail",
          detail: opened
            ? `Closed after ${alive}ms with code ${e.code}. ${
                quick
                  ? "Opened and died immediately, which is what a stolen upgrade event looks like."
                  : `${frames} frames received.`
              }`
            : `Never opened. Code ${e.code}.`,
        });
      };
    } catch (err) {
      setWs({ state: "fail", detail: `Could not open: ${String(err)}` });
    }
  }, []);

  return (
    <PageShell
      title="Feed check"
      lede={
        <>
          Read only. This page proves that voltick.cbedge.net reaches the CB Edge backend through its own
          nginx, and names the failure when it does not. A path that answers with{" "}
          <span style={{ fontFamily: MONO, color: PAPER }}>text/html</span> is not proxied: it fell through
          to the SPA fallback.
        </>
      }
      maxWidth={900}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card title="HTTP" subtitle="/api and /proxy, reverse proxied to dashboard:3002.">
          <button type="button" className="vk-pill" onClick={run} style={{ marginBottom: 14 }}>
            Run again
          </button>
          <div style={{ display: "grid", gap: 10 }}>
            {probes.map((p) => (
              <div
                key={p.path}
                style={{ border: `1px solid ${LINE}`, borderRadius: R_MD, padding: "12px 14px" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: MONO, fontSize: 13, color: ACCENT_TEXT }}>{p.path}</span>
                  <StateTag state={p.state} />
                </div>
                <div style={{ marginTop: 5, fontSize: 13, color: PAPER_QUIET }}>{p.what}</div>
                <pre
                  className="vk-xscroll"
                  style={{
                    margin: "9px 0 0",
                    padding: "9px 11px",
                    background: rgba(ACCENT, 0.06),
                    border: `1px solid ${LINE}`,
                    borderRadius: 8,
                    fontFamily: MONO,
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    color: PAPER,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {p.detail}
                </pre>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Websocket" subtitle="/ws/gex, topic scoped so this page cannot widen the socket for anyone else.">
          <button type="button" className="vk-pill" onClick={connect}>
            Connect
          </button>
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, fontSize: 13, color: ACCENT_TEXT }}>/ws/gex?topics={WS_TOPICS}</span>
            <StateTag state={ws.state === "open" ? "ok" : ws.state === "fail" ? "fail" : "idle"} />
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: PAPER_QUIET }}>{ws.detail}</div>
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: PAPER_QUIET }}>
            This connection is uncacheable and counts fully as bandwidth served, so it opens only when you
            press Connect and closes when you leave the page. Leave it closed unless you are checking it.
          </p>
        </Card>
      </div>
    </PageShell>
  );
}

function StateTag({ state }: { state: Probe["state"] | string }) {
  // GOOD and BAD are data colours, so they are not used for UI state here. The
  // tag says what happened in Paper, with chrome carrying the emphasis.
  void GOOD;
  void BAD;
  const map: Record<string, { text: string; ring: string; colour: string }> = {
    idle: { text: "Idle", ring: LINE, colour: PAPER_QUIET },
    running: { text: "Running", ring: rgba(ACCENT, 0.5), colour: ACCENT_TEXT },
    opening: { text: "Opening", ring: rgba(ACCENT, 0.5), colour: ACCENT_TEXT },
    open: { text: "Open", ring: rgba(ACCENT, 0.6), colour: ACCENT_TEXT },
    ok: { text: "Answered", ring: rgba(ACCENT, 0.6), colour: ACCENT_TEXT },
    closed: { text: "Closed", ring: LINE, colour: PAPER_QUIET },
    html: { text: "Not proxied", ring: rgba(ACCENT, 0.35), colour: PAPER },
    fail: { text: "Failed", ring: rgba(ACCENT, 0.35), colour: PAPER },
  };
  const m = map[state] ?? map.idle;
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9.5,
        fontWeight: W_MED,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: m.colour,
        border: `1px solid ${m.ring}`,
        borderRadius: R_PILL,
        padding: "2px 8px",
      }}
    >
      {m.text}
    </span>
  );
}
