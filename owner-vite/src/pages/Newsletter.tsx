import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  homeShellStyle,
  homeHeaderStyle,
  homeButtonStyle,
  homeSecondaryButtonStyle,
  homeInputStyle,
  classicCardAccentStyle,
  statTileStyle,
  OWNER_THEME,
  LIGHT_BLUE,
  rgba,
} from "../lib/theme";

/**
 * Newsletter — weekly builder for the CB Edge letter.
 * Sections: last week's daily recaps (Mon–Fri), upcoming events & earnings,
 * this-week outlook. Each recap and the outlook hold chart slots — drop in the
 * screenshots of what CB Edge called or saw. Draft auto-saves to localStorage;
 * "Export HTML" renders a standalone, email-ready newsletter you can copy/send.
 */

// ── model ────────────────────────────────────────────────────────────────────
type Chart = { id: string; src: string; caption: string };
type Recap = { day: string; date: string; body: string; charts: Chart[] };
type EventRow = { id: string; date: string; title: string; kind: "event" | "earnings" };
type Draft = {
  weekLabel: string;
  subject: string;
  intro: string;
  recaps: Recap[];
  events: EventRow[];
  outlook: string;
  outlookCharts: Chart[];
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const STORAGE_KEY = "cbedge:newsletter:draft:v1";
const uid = () => Math.random().toString(36).slice(2, 10);

function emptyDraft(): Draft {
  return {
    weekLabel: "",
    subject: "CB Edge Weekly — Week of ",
    intro: "",
    recaps: DAYS.map((day) => ({ day, date: "", body: "", charts: [] })),
    events: [],
    outlook: "",
    outlookCharts: [],
  };
}

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDraft();
    const p = JSON.parse(raw) as Partial<Draft>;
    const base = emptyDraft();
    return {
      ...base,
      ...p,
      recaps: Array.isArray(p.recaps) && p.recaps.length ? (p.recaps as Recap[]) : base.recaps,
      events: Array.isArray(p.events) ? (p.events as EventRow[]) : base.events,
      outlookCharts: Array.isArray(p.outlookCharts) ? (p.outlookCharts as Chart[]) : base.outlookCharts,
    };
  } catch {
    return emptyDraft();
  }
}

// ── small styled atoms ───────────────────────────────────────────────────────
const label: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: LIGHT_BLUE,
};
const sectionTitle: CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  letterSpacing: "0.02em",
  color: OWNER_THEME.text,
};
const areaStyle: CSSProperties = {
  ...homeInputStyle,
  width: "100%",
  minHeight: 96,
  resize: "vertical",
  lineHeight: 1.6,
  fontFamily: "inherit",
};

function Field({
  value,
  onChange,
  placeholder,
  area,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  area?: boolean;
  style?: CSSProperties;
}) {
  if (area) {
    return (
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...areaStyle, ...style }}
      />
    );
  }
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...homeInputStyle, width: "100%", ...style }}
    />
  );
}

// ── chart slot ───────────────────────────────────────────────────────────────
function ChartSlot({
  chart,
  onChange,
  onRemove,
}: {
  chart: Chart;
  onChange: (c: Chart) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pickFile = (f?: File | null) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => onChange({ ...chart, src: String(r.result || "") });
    r.readAsDataURL(f);
  };

  return (
    <div
      style={{
        border: `1px dashed ${rgba(LIGHT_BLUE, 0.35)}`,
        borderRadius: 12,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: rgba(LIGHT_BLUE, 0.03),
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        pickFile(e.dataTransfer.files?.[0]);
      }}
    >
      {chart.src ? (
        <img
          src={chart.src}
          alt={chart.caption || "chart"}
          style={{ width: "100%", borderRadius: 8, display: "block", border: `1px solid ${OWNER_THEME.border}` }}
        />
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{
            border: "none",
            background: "transparent",
            color: LIGHT_BLUE,
            cursor: "pointer",
            padding: "26px 10px",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          ＋ Add chart / screenshot — click or drop an image
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => pickFile(e.target.files?.[0])}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Field
          value={chart.caption}
          onChange={(v) => onChange({ ...chart, caption: v })}
          placeholder="Caption — e.g. SPX 0DTE gamma flip we flagged at 10:14"
          style={{ fontSize: 12 }}
        />
        {chart.src && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{ ...homeSecondaryButtonStyle, padding: "8px 10px", fontSize: 12, whiteSpace: "nowrap" }}
          >
            Replace
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          style={{
            ...homeSecondaryButtonStyle,
            padding: "8px 10px",
            fontSize: 12,
            color: OWNER_THEME.red,
            borderColor: rgba(OWNER_THEME.red, 0.4),
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function ChartGrid({
  charts,
  set,
}: {
  charts: Chart[];
  set: (c: Chart[]) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10 }}>
        {charts.map((c) => (
          <ChartSlot
            key={c.id}
            chart={c}
            onChange={(nc) => set(charts.map((x) => (x.id === c.id ? nc : x)))}
            onRemove={() => set(charts.filter((x) => x.id !== c.id))}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => set([...charts, { id: uid(), src: "", caption: "" }])}
        style={{ ...homeSecondaryButtonStyle, alignSelf: "flex-start", fontSize: 12 }}
      >
        ＋ Chart slot
      </button>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...classicCardAccentStyle, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      {children}
    </div>
  );
}

// ── export → standalone HTML ─────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function para(s: string): string {
  return esc(s)
    .split(/\n{2,}/)
    .filter((b) => b.trim())
    .map((b) => `<p style="margin:0 0 12px;line-height:1.6">${b.replace(/\n/g, "<br>")}</p>`)
    .join("");
}
// dashboard-theme tokens for the exported HTML (mirror lib/theme.ts)
const NL = {
  bg: "#05060A",
  card: "background:rgba(13,17,25,0.55);border:1px solid rgba(255,255,255,0.10);border-radius:18px;box-shadow:0 18px 40px rgba(0,0,0,0.35)",
  cyan: "#7dd3fc",
  orange: "#FB8501",
  green: "#8ECAE6",
  text: "#e8edf5",
  muted: "#8aa0b8",
  hair: "rgba(255,255,255,0.10)",
};
function kicker(t: string): string {
  return `<div style="display:flex;align-items:center;gap:10px;margin:0 0 14px"><span style="font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${NL.orange}">${esc(
    t
  )}</span><span style="flex:1;height:1px;background:linear-gradient(90deg,${NL.orange}55,transparent)"></span></div>`;
}
function chartsHtml(charts: Chart[]): string {
  const shown = charts.filter((c) => c.src);
  if (!shown.length) return "";
  return shown
    .map(
      (c) =>
        `<figure style="margin:16px 0 0"><img src="${c.src}" style="width:100%;border-radius:12px;border:1px solid ${NL.hair};box-shadow:0 10px 26px rgba(0,0,0,0.35);display:block"/>${
          c.caption
            ? `<figcaption style="font-size:12px;color:${NL.green};margin-top:8px;letter-spacing:.01em">${esc(c.caption)}</figcaption>`
            : ""
        }</figure>`
    )
    .join("");
}
function buildHtml(d: Draft): string {
  const recaps = d.recaps
    .filter((r) => r.body.trim() || r.charts.some((c) => c.src))
    .map(
      (r) =>
        `<div style="${NL.card};padding:18px 20px;margin:0 0 14px"><div style="display:flex;align-items:baseline;gap:10px;margin:0 0 8px"><span style="font-size:16px;font-weight:800;color:${NL.cyan}">${esc(
          r.day
        )}</span>${
          r.date ? `<span style="font-size:12px;color:${NL.muted};font-weight:600">${esc(r.date)}</span>` : ""
        }</div><div style="color:${NL.text}">${para(r.body)}</div>${chartsHtml(r.charts)}</div>`
    )
    .join("");
  const events = d.events.length
    ? `<div style="${NL.card};padding:14px 18px"><table style="width:100%;border-collapse:collapse">${d.events
        .map(
          (e, i) =>
            `<tr style="${i ? `border-top:1px solid ${NL.hair}` : ""}"><td style="padding:9px 12px 9px 0;color:${
              NL.muted
            };white-space:nowrap;vertical-align:top;font-size:13px">${esc(
              e.date
            )}</td><td style="padding:9px 0;vertical-align:top;color:${NL.text}"><span style="font-size:10px;font-weight:800;letter-spacing:.08em;padding:2px 8px;border-radius:999px;margin-right:8px;${
              e.kind === "earnings"
                ? `background:rgba(251,133,1,0.12);border:1px solid rgba(251,133,1,0.35);color:${NL.orange}`
                : `background:rgba(125,211,252,0.12);border:1px solid rgba(125,211,252,0.35);color:${NL.cyan}`
            }">${e.kind === "earnings" ? "EARNINGS" : "EVENT"}</span>${esc(e.title)}</td></tr>`
        )
        .join("")}</table></div>`
    : "";
  const outlook =
    d.outlook.trim() || d.outlookCharts.some((c) => c.src)
      ? `<div style="${NL.card};padding:18px 20px;color:${NL.text};font-size:15px">${para(d.outlook)}${chartsHtml(
          d.outlookCharts
        )}</div>`
      : "";
  const shellGlow =
    "radial-gradient(circle at 15% 8%,rgba(33,158,188,0.10) 0%,transparent 42%),radial-gradient(circle at 85% 4%,rgba(251,133,1,0.06) 0%,transparent 40%),radial-gradient(circle at 50% 100%,rgba(18,103,131,0.10) 0%,transparent 55%)";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(
    d.subject || "CB Edge Weekly"
  )}</title></head><body style="margin:0;background:${NL.bg};background-image:${shellGlow};color:${NL.text};font-family:Inter,-apple-system,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased">
<div style="max-width:680px;margin:0 auto;padding:28px 20px 40px">
  <div style="${NL.card};position:relative;overflow:hidden;padding:24px 24px 22px;margin:0 0 22px">
    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(33,158,188,0.9) 50%,transparent)"></div>
    <div style="font-size:11px;letter-spacing:.20em;text-transform:uppercase;color:${NL.cyan};font-weight:800">CB Edge Weekly</div>
    <h1 style="margin:8px 0 2px;font-size:27px;line-height:1.1;color:#fff">${esc(d.subject || "CB Edge Weekly")}</h1>
    ${d.weekLabel ? `<div style="color:${NL.muted};font-size:14px;font-weight:600">${esc(d.weekLabel)}</div>` : ""}
    ${d.intro.trim() ? `<div style="font-size:15px;margin-top:14px;color:${NL.text}">${para(d.intro)}</div>` : ""}
  </div>
  ${recaps ? `<div style="margin-bottom:26px">${kicker("Last Week — Daily Recaps")}${recaps}</div>` : ""}
  ${events ? `<div style="margin-bottom:26px">${kicker("Upcoming Events & Earnings")}${events}</div>` : ""}
  ${outlook ? `<div style="margin-bottom:26px">${kicker("This Week — Outlook")}${outlook}</div>` : ""}
  <div style="margin-top:14px;padding-top:16px;border-top:1px solid ${NL.hair};color:${NL.muted};font-size:12px;text-align:center">CB Edge · <span style="color:${NL.cyan}">cbedge.net</span> · Not financial advice.</div>
</div></body></html>`;
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function Newsletter() {
  const [d, setD] = useState<Draft>(loadDraft);
  const [saved, setSaved] = useState<"idle" | "saved">("idle");
  const [preview, setPreview] = useState(false);

  // autosave (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
        setSaved("saved");
        const c = setTimeout(() => setSaved("idle"), 1200);
        return () => clearTimeout(c);
      } catch {
        /* quota — ignore */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [d]);

  const html = useMemo(() => buildHtml(d), [d]);
  const set = (patch: Partial<Draft>) => setD((p) => ({ ...p, ...patch }));
  const setRecap = (i: number, patch: Partial<Recap>) =>
    setD((p) => ({ ...p, recaps: p.recaps.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const chartCount =
    d.recaps.reduce((n, r) => n + r.charts.filter((c) => c.src).length, 0) +
    d.outlookCharts.filter((c) => c.src).length;

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(html);
      alert("Newsletter HTML copied to clipboard.");
    } catch {
      /* ignore */
    }
  };
  const downloadHtml = () => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cbedge-newsletter-${(d.weekLabel || "draft").replace(/[^\w.-]+/g, "-")}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const resetDraft = () => {
    if (confirm("Clear the whole newsletter draft?")) setD(emptyDraft());
  };

  return (
    <div style={homeShellStyle}>
      <div style={homeHeaderStyle}>
        <span style={{ fontSize: 17, fontWeight: 600, color: OWNER_THEME.text }}>Newsletter</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: saved === "saved" ? OWNER_THEME.green : OWNER_THEME.muted, opacity: 0.7 }}>
            {saved === "saved" ? "✓ saved" : "auto-saves"}
          </span>
          <button type="button" onClick={() => setPreview((v) => !v)} style={homeSecondaryButtonStyle}>
            {preview ? "Edit" : "Preview"}
          </button>
          <button type="button" onClick={copyHtml} style={homeSecondaryButtonStyle}>
            Copy HTML
          </button>
          <button type="button" onClick={downloadHtml} style={homeButtonStyle}>
            Export HTML
          </button>
        </div>
      </div>

      {preview ? (
        <div style={{ flex: 1, minHeight: 0, padding: "clamp(14px,2vw,22px)" }}>
          <iframe
            title="newsletter preview"
            srcDoc={html}
            style={{ width: "100%", height: "100%", border: `1px solid ${OWNER_THEME.border}`, borderRadius: 16, background: "#05060a" }}
          />
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "clamp(14px,2vw,22px)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* stat row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            {[
              { k: "Recaps", v: `${d.recaps.filter((r) => r.body.trim()).length}/5` },
              { k: "Charts", v: chartCount },
              { k: "Events", v: d.events.length },
              { k: "Outlook", v: d.outlook.trim() ? "drafted" : "—" },
            ].map((s) => (
              <div key={s.k} style={{ ...statTileStyle, padding: "12px 16px" }}>
                <div style={label}>{s.k}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: OWNER_THEME.text, marginTop: 4 }}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* meta */}
          <Section>
            <div style={sectionTitle}>Issue</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={label}>Subject line</div>
                <Field value={d.subject} onChange={(v) => set({ subject: v })} placeholder="CB Edge Weekly — Week of Jul 21" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={label}>Week label</div>
                <Field value={d.weekLabel} onChange={(v) => set({ weekLabel: v })} placeholder="Jul 14 – Jul 18, 2026" />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={label}>Intro / note</div>
              <Field area value={d.intro} onChange={(v) => set({ intro: v })} placeholder="One or two lines setting up the week…" />
            </div>
          </Section>

          {/* daily recaps */}
          <Section>
            <div style={sectionTitle}>Last Week — Daily Recaps</div>
            {d.recaps.map((r, i) => (
              <div
                key={r.day}
                style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 14, borderBottom: i < 4 ? `1px solid ${OWNER_THEME.border}` : "none" }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: LIGHT_BLUE, minWidth: 92 }}>{r.day}</span>
                  <Field value={r.date} onChange={(v) => setRecap(i, { date: v })} placeholder="Jul 14" style={{ maxWidth: 140, fontSize: 12 }} />
                </div>
                <Field
                  area
                  value={r.body}
                  onChange={(v) => setRecap(i, { body: v })}
                  placeholder={`What CB Edge called / saw on ${r.day} — levels hit, GEX flips, flow, the trade…`}
                />
                <ChartGrid charts={r.charts} set={(c) => setRecap(i, { charts: c })} />
              </div>
            ))}
          </Section>

          {/* events & earnings */}
          <Section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={sectionTitle}>Upcoming Events &amp; Earnings</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => set({ events: [...d.events, { id: uid(), date: "", title: "", kind: "event" }] })}
                  style={{ ...homeSecondaryButtonStyle, fontSize: 12 }}
                >
                  ＋ Event
                </button>
                <button
                  type="button"
                  onClick={() => set({ events: [...d.events, { id: uid(), date: "", title: "", kind: "earnings" }] })}
                  style={{ ...homeSecondaryButtonStyle, fontSize: 12 }}
                >
                  ＋ Earnings
                </button>
              </div>
            </div>
            {d.events.length === 0 && (
              <div style={{ fontSize: 13, color: OWNER_THEME.muted, opacity: 0.6 }}>
                No rows yet — add CPI/FOMC/OPEX and the week's earnings.
              </div>
            )}
            {d.events.map((e) => (
              <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  value={e.kind}
                  onChange={(ev) => set({ events: d.events.map((x) => (x.id === e.id ? { ...x, kind: ev.target.value as EventRow["kind"] } : x)) })}
                  style={{ ...homeInputStyle, width: 110, flexShrink: 0 }}
                >
                  <option value="event">Event</option>
                  <option value="earnings">Earnings</option>
                </select>
                <Field
                  value={e.date}
                  onChange={(v) => set({ events: d.events.map((x) => (x.id === e.id ? { ...x, date: v } : x)) })}
                  placeholder="Mon Jul 21, 8:30a"
                  style={{ maxWidth: 180 }}
                />
                <Field
                  value={e.title}
                  onChange={(v) => set({ events: d.events.map((x) => (x.id === e.id ? { ...x, title: v } : x)) })}
                  placeholder={e.kind === "earnings" ? "TSLA after close" : "CPI · FOMC · Monthly OPEX"}
                />
                <button
                  type="button"
                  onClick={() => set({ events: d.events.filter((x) => x.id !== e.id) })}
                  style={{ ...homeSecondaryButtonStyle, padding: "8px 10px", fontSize: 12, color: OWNER_THEME.red, borderColor: rgba(OWNER_THEME.red, 0.4) }}
                >
                  ✕
                </button>
              </div>
            ))}
          </Section>

          {/* outlook */}
          <Section>
            <div style={sectionTitle}>This Week — Outlook</div>
            <Field
              area
              value={d.outlook}
              onChange={(v) => set({ outlook: v })}
              placeholder="The setup into the week — key SPX levels, gamma regime, the events that matter, what you're watching…"
              style={{ minHeight: 140 }}
            />
            <div style={label}>Charts / examples</div>
            <ChartGrid charts={d.outlookCharts} set={(c) => set({ outlookCharts: c })} />
          </Section>

          <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: 8 }}>
            <button
              type="button"
              onClick={resetDraft}
              style={{ ...homeSecondaryButtonStyle, fontSize: 12, color: OWNER_THEME.red, borderColor: rgba(OWNER_THEME.red, 0.4) }}
            >
              Clear draft
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
