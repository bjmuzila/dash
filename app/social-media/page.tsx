"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ────────────────────────────────────────────────────────────────────────────
 * Social Media (admin) — turns the daily pre-market GEX read into social posts.
 *
 * Left "Daily Input" panel hydrates from live dashboard state via
 * /api/social-media/daily-input (SPX spot / gamma flip / call+put walls /
 * expected move / net GEX / ES overnight H-L) and seeds the Bias field from the
 * Greeks options-flow regime (/api/insights/gex → same evaluateGamma logic).
 * Every field stays editable so it can be overridden on event days.
 *
 * Right column renders three generated cards (X single, X thread, Discord drop)
 * from /api/social-media/generate (Anthropic claude-sonnet-4-6). Copy buttons
 * flash "Copied ✓"; X buttons open the tweet intent and (for the thread) also
 * copy the full sequence for pasting posts 2-6.
 *
 * Themed with the dashboard's tokens. The page aliases the legacy v2 names the
 * design reference used (--bg0/--bg1/--cyan/--text2…) onto the real global
 * stylesheet tokens (--bg/--surface/--accent/--text…) so nothing hardcodes a
 * new color and the names resolve on this route.
 * ──────────────────────────────────────────────────────────────────────────── */

const X_LIMIT = 280;

interface DailyInput {
  spxSpot: number | null;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  expectedMove: number | null;
  expectedMoveExpiry: string | null;
  netGex: number | null;
  esOvernightHigh: number | null;
  esOvernightLow: number | null;
}

interface GeneratedPosts {
  xPost: string;
  xThread: string[];
  discordDrop: string;
}

// Editable form state — strings so partial edits never coerce to NaN mid-type.
interface FormState {
  spot: string;
  flip: string;
  call: string;
  put: string;
  em: string;
  gex: string;
  ovn: string;
  bias: string;
}

const EMPTY_FORM: FormState = {
  spot: "",
  flip: "",
  call: "",
  put: "",
  em: "",
  gex: "",
  ovn: "",
  bias: "",
};

function toNum(v: string | number | null | undefined): number {
  if (v == null) return NaN;
  return parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "";
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

// ── Bias from the options-flow regime ────────────────────────────────────────
// Mirrors the Greeks page's gamma read at a high level: net-GEX sign + spot vs
// flip decide the dominant regime label and a one-line lean. Kept deliberately
// small (the Greeks page owns the full signal engine); this is just the seed.
function deriveBias(netGex: number, spot: number, flip: number): string {
  const negative = (Number.isFinite(netGex) && netGex < 0) || (Number.isFinite(spot) && Number.isFinite(flip) && spot < flip);
  if (negative) {
    return "Negative-gamma regime — dealers amplify moves; downside favored while we hold under the flip.";
  }
  return "Positive-gamma regime — dealers dampen moves; mean-reversion favored while we hold over the flip.";
}

// ── Gamma regime (strip) ─────────────────────────────────────────────────────
function regimeOf(form: FormState): { neg: boolean; label: string; sub: string } {
  const spot = toNum(form.spot);
  const flip = toNum(form.flip);
  const gex = toNum(form.gex);
  const negative = (Number.isFinite(gex) && gex < 0) || (Number.isFinite(spot) && Number.isFinite(flip) && spot < flip);
  return negative
    ? {
        neg: true,
        label: "NEGATIVE GAMMA",
        sub: "Spot under the flip · dealers amplify moves — plan for trend, not chop.",
      }
    : {
        neg: false,
        label: "POSITIVE GAMMA",
        sub: "Spot over the flip · dealers dampen moves — fade extremes, expect mean-reversion.",
      };
}

// ── Copy helper with execCommand fallback ────────────────────────────────────
async function copyText(t: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }
}

function openXIntent(text: string): void {
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
    "_blank",
    "noopener"
  );
}

// ── Small flashing button (Copy → Copied ✓) ──────────────────────────────────
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <button
      type="button"
      className={`sm-btn${copied ? " copied" : ""}`}
      onClick={() => {
        copyText(text).then(() => {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

// ── Level ladder ─────────────────────────────────────────────────────────────
function LevelLadder({ form }: { form: FormState }) {
  const pts = useMemo(() => {
    const raw = [
      { k: "call", lab: "Call wall", v: toNum(form.call) },
      { k: "flip", lab: "Gamma flip", v: toNum(form.flip) },
      { k: "spot", lab: "Spot", v: toNum(form.spot) },
      { k: "put", lab: "Put wall", v: toNum(form.put) },
    ].filter((p) => Number.isFinite(p.v));
    raw.sort((a, b) => b.v - a.v);
    return raw;
  }, [form.call, form.flip, form.spot, form.put]);

  if (!pts.length) return null;
  const vals = pts.map((p) => p.v);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const span = hi - lo || 1;

  return (
    <div className="sm-ladder">
      {pts.map((p) => {
        const pct = ((p.v - lo) / span) * 100;
        return (
          <div key={p.k} className={`sm-ladder-row dot-${p.k}`}>
            <span className="lab">{p.lab}</span>
            <span className="bar">
              <i style={{ left: `${pct.toFixed(1)}%` }} />
            </span>
            <span className="val">{p.v.toLocaleString("en-US")}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── X thread card ────────────────────────────────────────────────────────────
function ThreadCard({ thread }: { thread: string[] }) {
  const joined = useMemo(() => thread.join("\n\n———\n\n"), [thread]);
  return (
    <div className="sm-card">
      <div className="sm-card-h">
        <span className="ti">X · Thread ({thread.length})</span>
        <span className="ct">{thread.length} posts</span>
      </div>
      <div className="sm-card-b">
        {thread.map((post, i) => {
          const over = post.length > X_LIMIT;
          return (
            <div className="sm-thread-post" key={i}>
              <div className="n">
                {i + 1}/{thread.length} · <span className={over ? "over" : undefined}>{post.length}{over ? " ⚠ over" : ""}</span>
              </div>
              <pre>{post}</pre>
            </div>
          );
        })}
      </div>
      <div className="sm-acts">
        <CopyButton text={joined} label="Copy thread" />
        <button
          type="button"
          className="sm-btn x"
          onClick={() => {
            // Intent opens post 1; full sequence goes to the clipboard so the
            // user can paste replies 2..n in order.
            openXIntent(thread[0] ?? "");
            void copyText(joined);
          }}
        >
          Copy to X →
        </button>
      </div>
    </div>
  );
}

// ── Single-text card (X single / Discord) ────────────────────────────────────
function TextCard({
  title,
  text,
  showX,
}: {
  title: string;
  text: string;
  showX: boolean;
}) {
  const over = text.length > X_LIMIT;
  return (
    <div className="sm-card">
      <div className="sm-card-h">
        <span className="ti">{title}</span>
        {showX ? (
          <span className={`ct${over ? " over" : ""}`}>
            {text.length}/{X_LIMIT}
          </span>
        ) : (
          <span className="ct">{text.length} chars</span>
        )}
      </div>
      <div className="sm-card-b">
        <pre>{text}</pre>
      </div>
      <div className="sm-acts">
        <CopyButton text={text} />
        {showX && (
          <button type="button" className="sm-btn x" onClick={() => openXIntent(text)}>
            Post to X
          </button>
        )}
      </div>
    </div>
  );
}

export default function SocialMediaPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [posts, setPosts] = useState<GeneratedPosts | null>(null);
  const [genState, setGenState] = useState<"idle" | "busy">("idle");
  const [genError, setGenError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Once the user edits a field we stop overwriting it on the next hydrate poll.
  const dirtyRef = useRef(false);

  const today = useMemo(
    () => new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }),
    []
  );

  const setField = (key: keyof FormState, value: string) => {
    dirtyRef.current = true;
    setForm((f) => ({ ...f, [key]: value }));
  };

  // Hydrate the Daily Input from live dashboard state. Runs on mount and lets
  // the user freeze it by editing (dirtyRef) — a re-hydrate won't clobber edits.
  const hydrate = useCallback(async () => {
    try {
      const r = await fetch("/api/social-media/daily-input", { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json();
      const d = (json?.data ?? json) as DailyInput;
      if (dirtyRef.current) {
        setHydrated(true);
        return;
      }
      const spot = d.spxSpot ?? NaN;
      const flip = d.gammaFlip ?? NaN;
      const netGex = d.netGex ?? NaN;
      const ovn =
        d.esOvernightHigh != null && d.esOvernightLow != null
          ? `${fmt(d.esOvernightHigh)} / ${fmt(d.esOvernightLow)}`
          : "";
      setForm({
        spot: d.spxSpot != null ? fmt(d.spxSpot) : "",
        flip: d.gammaFlip != null ? fmt(d.gammaFlip) : "",
        call: d.callWall != null ? fmt(d.callWall) : "",
        put: d.putWall != null ? fmt(d.putWall) : "",
        em: d.expectedMove != null ? fmt(d.expectedMove) : "",
        gex: d.netGex != null ? `${d.netGex >= 0 ? "+" : ""}${fmt(d.netGex, 2)}B` : "",
        ovn,
        bias:
          Number.isFinite(netGex) || (Number.isFinite(spot) && Number.isFinite(flip))
            ? deriveBias(netGex, spot, flip)
            : "",
      });
      setHydrated(true);
    } catch {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const regime = regimeOf(form);

  const generate = useCallback(async () => {
    setGenState("busy");
    setGenError(null);
    try {
      const body = {
        date: today,
        spxSpot: toNum(form.spot),
        gammaFlip: toNum(form.flip),
        callWall: toNum(form.call),
        putWall: toNum(form.put),
        expectedMove: toNum(form.em),
        netGex: toNum(form.gex),
        esOvernightHigh: toNum(form.ovn.split("/")[0] ?? ""),
        esOvernightLow: toNum(form.ovn.split("/")[1] ?? ""),
        gammaRegime: regime.label,
        bias: form.bias,
      };
      const r = await fetch("/api/social-media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok) {
        setGenError(json?.error ? String(json.error) : `Generation failed (${r.status})`);
        return;
      }
      const data = (json?.data ?? json) as GeneratedPosts;
      setPosts({
        xPost: data.xPost ?? "",
        xThread: Array.isArray(data.xThread) ? data.xThread : [],
        discordDrop: data.discordDrop ?? "",
      });
    } catch (err) {
      setGenError(String((err as Error)?.message || err));
    } finally {
      setGenState("idle");
    }
  }, [form, regime.label, today]);

  return (
    <div id="page-social-media" className="sm-page">
      <style>{`
        /* Alias the design-reference token names onto the real global tokens so
           nothing introduces a new color and the names resolve on this route. */
        #page-social-media {
          --bg0: var(--bg, #05060a);
          --bg1: var(--surface-solid, #0d1119);
          --bg2: #161b22;
          --bg3: #21262d;
          --bg4: #2d333b;
          --cyan: var(--accent, #00f0ff);
          --amber: var(--yellow, #f97316);
          --sm-red: var(--red, #ef4444);
          --sm-green: #10b981;
          --text1: var(--text, #ffffff);
          --text2: #c9d4e3;
          --sm-muted: var(--muted, #8b94a7);
          --sm-border: var(--border, rgba(255,255,255,0.1));
          --sm-mono: ui-monospace, "SF Mono", Menlo, monospace;

          flex: 1;
          min-height: 0;
          overflow-y: auto;
          background: var(--bg0);
          color: var(--text2);
          font-family: Arial, "Helvetica Neue", sans-serif;
          padding: 24px;
        }
        #page-social-media * { box-sizing: border-box; }

        .sm-head { display: flex; align-items: baseline; gap: 14px; border-bottom: 1px solid var(--sm-border); padding-bottom: 14px; margin-bottom: 22px; max-width: 1100px; margin-left: auto; margin-right: auto; }
        .sm-head h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.02em; margin: 0; color: var(--text1); }
        .sm-tag { font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--amber); border: 1px solid var(--amber); border-radius: 3px; padding: 2px 6px; opacity: 0.85; }
        .sm-date { margin-left: auto; font-family: var(--sm-mono); font-size: 13px; color: var(--sm-muted); }
        .sm-live { font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cyan); display: flex; align-items: center; gap: 5px; }
        .sm-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 8px var(--cyan); display: inline-block; }

        .sm-grid { display: grid; grid-template-columns: 360px 1fr; gap: 22px; align-items: start; max-width: 1100px; margin: 0 auto; }
        @media (max-width: 820px) { .sm-grid { grid-template-columns: 1fr; } }

        .sm-panel { background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 8px; overflow: hidden; }
        .sm-panel-h { font-family: var(--sm-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sm-muted); padding: 11px 14px; background: var(--bg2); border-bottom: 1px solid var(--sm-border); display: flex; align-items: center; gap: 8px; }
        .sm-panel-b { padding: 16px; }

        .sm-regime { font-family: var(--sm-mono); border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; border: 1px solid var(--sm-border); }
        .sm-regime.neg { border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.07); }
        .sm-regime.pos { border-color: rgba(16,185,129,0.4); background: rgba(16,185,129,0.07); }
        .sm-regime-label { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
        .sm-regime.neg .sm-regime-label { color: var(--sm-red); }
        .sm-regime.pos .sm-regime-label { color: var(--sm-green); }
        .sm-regime-sub { font-size: 11px; color: var(--sm-muted); margin-top: 4px; }

        .sm-ladder { margin: 4px 0 16px; font-family: var(--sm-mono); font-size: 11px; }
        .sm-ladder-row { display: grid; grid-template-columns: 92px 1fr 72px; align-items: center; gap: 8px; padding: 3px 0; }
        .sm-ladder-row .lab { color: var(--sm-muted); }
        .sm-ladder-row .bar { height: 2px; background: var(--bg4); position: relative; border-radius: 2px; }
        .sm-ladder-row .bar i { position: absolute; top: -3px; height: 8px; width: 8px; border-radius: 50%; transform: translateX(-50%); }
        .sm-ladder-row .val { text-align: right; color: var(--text1); }
        .dot-call i { background: var(--sm-red); }
        .dot-flip i { background: var(--amber); }
        .dot-spot i { background: var(--cyan); box-shadow: 0 0 0 3px rgba(0,240,255,0.18); }
        .dot-put i { background: var(--sm-green); }

        .sm-field { margin-bottom: 11px; }
        .sm-field label { display: block; font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sm-muted); margin-bottom: 4px; }
        .sm-field input, .sm-field textarea { width: 100%; background: var(--bg0); color: var(--text1); border: 1px solid var(--sm-border); border-radius: 5px; padding: 8px 10px; font-family: var(--sm-mono); font-size: 13px; transition: border-color 0.15s; }
        .sm-field input:focus, .sm-field textarea:focus { outline: none; border-color: var(--cyan); }
        .sm-field textarea { resize: vertical; min-height: 56px; line-height: 1.4; }
        .sm-field .hint { font-size: 10px; color: var(--sm-muted); margin-top: 3px; font-family: var(--sm-mono); }
        .sm-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

        .sm-gen { width: 100%; margin-top: 6px; padding: 11px; font-family: var(--sm-mono); font-size: 13px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; background: var(--cyan); color: #05060a; border: none; border-radius: 6px; transition: opacity 0.15s, transform 0.05s; }
        .sm-gen:hover { opacity: 0.9; }
        .sm-gen:active { transform: translateY(1px); }
        .sm-gen:disabled { opacity: 0.45; cursor: not-allowed; }

        .sm-out { display: flex; flex-direction: column; gap: 16px; }
        .sm-card { background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 8px; overflow: hidden; }
        .sm-card-h { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--bg2); border-bottom: 1px solid var(--sm-border); }
        .sm-card-h .ti { font-family: var(--sm-mono); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text1); }
        .sm-card-h .ct { font-family: var(--sm-mono); font-size: 11px; color: var(--sm-muted); margin-left: auto; }
        .sm-card-h .ct.over { color: var(--sm-red); }
        .sm-card-b { padding: 14px; }
        .sm-card-b pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--sm-mono); font-size: 13px; color: var(--text1); line-height: 1.55; }
        .sm-thread-post { padding: 11px 0; border-bottom: 1px dashed var(--sm-border); }
        .sm-thread-post:last-child { border-bottom: none; padding-bottom: 0; }
        .sm-thread-post:first-child { padding-top: 0; }
        .sm-thread-post .n { font-family: var(--sm-mono); font-size: 10px; color: var(--cyan); margin-bottom: 4px; }
        .sm-thread-post .n .over { color: var(--sm-red); }

        .sm-acts { display: flex; gap: 8px; padding: 0 14px 14px; }
        .sm-btn { font-family: var(--sm-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 7px 12px; border-radius: 5px; border: 1px solid var(--sm-border); background: var(--bg3); color: var(--text1); transition: all 0.12s; }
        .sm-btn:hover { background: var(--bg4); }
        .sm-btn.x { background: var(--text1); color: #000; border-color: var(--text1); }
        .sm-btn.x:hover { opacity: 0.88; }
        .sm-btn.copied { background: var(--sm-green); color: #05060a; border-color: var(--sm-green); }

        .sm-empty { border: 1px dashed var(--sm-border); border-radius: 8px; padding: 40px 20px; text-align: center; color: var(--sm-muted); font-family: var(--sm-mono); font-size: 13px; }
        .sm-empty.err { border-color: rgba(239,68,68,0.4); color: var(--sm-red); }
      `}</style>

      <div className="sm-head">
        <h1>Social Media</h1>
        <span className="sm-tag">Admin</span>
        <span className="sm-live"><i />{hydrated ? "Live state" : "Hydrating…"}</span>
        <span className="sm-date">{today}</span>
      </div>

      <div className="sm-grid">
        {/* LEFT: dashboard-derived input */}
        <div className="sm-panel">
          <div className="sm-panel-h">Daily Input · from dashboard state</div>
          <div className="sm-panel-b">
            <div className={`sm-regime ${regime.neg ? "neg" : "pos"}`}>
              <div className="sm-regime-label">{regime.label}</div>
              <div className="sm-regime-sub">{regime.sub}</div>
            </div>

            <LevelLadder form={form} />

            <div className="sm-row2">
              <div className="sm-field">
                <label>SPX Spot</label>
                <input value={form.spot} onChange={(e) => setField("spot", e.target.value)} />
              </div>
              <div className="sm-field">
                <label>Gamma Flip</label>
                <input value={form.flip} onChange={(e) => setField("flip", e.target.value)} />
              </div>
            </div>
            <div className="sm-row2">
              <div className="sm-field">
                <label>Call Wall</label>
                <input value={form.call} onChange={(e) => setField("call", e.target.value)} />
              </div>
              <div className="sm-field">
                <label>Put Wall</label>
                <input value={form.put} onChange={(e) => setField("put", e.target.value)} />
              </div>
            </div>
            <div className="sm-row2">
              <div className="sm-field">
                <label>Expected Move ±</label>
                <input value={form.em} onChange={(e) => setField("em", e.target.value)} />
              </div>
              <div className="sm-field">
                <label>Net GEX</label>
                <input value={form.gex} onChange={(e) => setField("gex", e.target.value)} />
              </div>
            </div>
            <div className="sm-field">
              <label>ES Overnight (H / L)</label>
              <input value={form.ovn} onChange={(e) => setField("ovn", e.target.value)} placeholder="high / low" />
            </div>
            <div className="sm-field">
              <label>Bias · from Greeks flow regime</label>
              <textarea value={form.bias} onChange={(e) => setField("bias", e.target.value)} />
              <div className="hint">pre-filled from options-flow regime — edit on event days</div>
            </div>

            <button
              type="button"
              className="sm-gen"
              onClick={generate}
              disabled={genState === "busy"}
            >
              {genState === "busy" ? "Generating…" : posts ? "Regenerate" : "Generate posts"}
            </button>
          </div>
        </div>

        {/* RIGHT: generated output */}
        <div className="sm-out">
          {genError ? (
            <div className="sm-empty err">{genError}</div>
          ) : posts ? (
            <>
              <TextCard title="X · Single post" text={posts.xPost} showX />
              {posts.xThread.length > 0 && <ThreadCard thread={posts.xThread} />}
              <TextCard title="Discord · Members drop" text={posts.discordDrop} showX={false} />
            </>
          ) : (
            <div className="sm-empty">Fill the block and hit <b>Generate posts</b>.</div>
          )}
        </div>
      </div>
    </div>
  );
}
