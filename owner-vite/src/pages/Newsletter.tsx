import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent, DragEvent } from "react";
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
 * Newsletter — the idea log the weekly letter gets written from.
 *
 * One thing per entry: the idea (one line), what you want to say about it, and
 * the screenshots that prove it. Capture them any day; at the end of the week
 * pick the week, hit "Copy week", and write the newsletter off the real notes
 * instead of memory.
 *
 * Everything lives in Postgres behind /api/newsletter-ideas (owner-gated), so
 * it survives a cache clear and follows you between machines. Screenshots are
 * stored server-side and streamed back from /api/newsletter-ideas/shot?id=N —
 * they never sit in localStorage.
 */

// ── model ────────────────────────────────────────────────────────────────────
type Shot = { id: number; caption: string };
type Idea = {
  id: number;
  title: string;
  body: string;
  day: string;        // YYYY-MM-DD
  week_start: string; // YYYY-MM-DD (Monday)
  used: boolean;
  shots: Shot[];
};
type WeekRow = { week: string; n: number };
/** A screenshot staged in the composer, before the idea has an id. */
type Pending = { key: string; dataUrl: string; caption: string };

const API = "/api/newsletter-ideas";
const shotUrl = (id: number) => `${API}/shot?id=${id}`;
const uid = () => Math.random().toString(36).slice(2, 10);

// ── dates (local, matches the server's ET-anchored week) ─────────────────────
function todayStr(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString()
    .slice(0, 10);
}
function mondayOf(ds: string): string {
  const d = new Date(`${ds}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}
function fmtDay(ds: string): string {
  const d = new Date(`${ds}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function fmtWeek(ds: string): string {
  const a = new Date(`${ds}T12:00:00Z`);
  const b = new Date(a);
  b.setUTCDate(b.getUTCDate() + 4);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  return `${a.toLocaleDateString("en-US", opts)} – ${b.toLocaleDateString("en-US", opts)}`;
}

// ── image handling — downscale before upload so a 4K screenshot isn't 6 MB ────
const MAX_EDGE = 1800;
const JPEG_Q = 0.78;
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const src = String(reader.result || "");
      const img = new Image();
      img.onerror = () => resolve(src); // can't decode → ship the original
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        if (scale >= 1 && src.length < 900_000) { resolve(src); return; }
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext("2d");
        if (!ctx) { resolve(src); return; }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", JPEG_Q));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
function imagesFrom(list: FileList | File[] | null | undefined): File[] {
  return Array.from(list || []).filter((f) => f.type.startsWith("image/"));
}

// ── styled atoms ─────────────────────────────────────────────────────────────
const label: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: LIGHT_BLUE,
};
const areaStyle: CSSProperties = {
  ...homeInputStyle,
  width: "100%",
  minHeight: 110,
  resize: "vertical",
  lineHeight: 1.6,
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const dangerButton: CSSProperties = {
  ...homeSecondaryButtonStyle,
  padding: "7px 10px",
  fontSize: 12,
  color: OWNER_THEME.red,
  borderColor: rgba(OWNER_THEME.red, 0.4),
};
const smallButton: CSSProperties = { ...homeSecondaryButtonStyle, padding: "7px 10px", fontSize: 12 };

function Card({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ ...classicCardAccentStyle, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, ...style }}>
      {children}
    </div>
  );
}

/** Thumbnail strip — click to blow one up, ✕ to drop it. */
function Thumbs({
  items,
  onOpen,
  onRemove,
  onCaption,
}: {
  items: { key: string; src: string; caption: string }[];
  onOpen: (src: string) => void;
  onRemove: (key: string) => void;
  onCaption?: (key: string, caption: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 10 }}>
      {items.map((it) => (
        <div
          key={it.key}
          style={{
            border: `1px solid ${OWNER_THEME.border}`,
            borderRadius: 12,
            overflow: "hidden",
            background: rgba(LIGHT_BLUE, 0.03),
            display: "flex",
            flexDirection: "column",
          }}
        >
          <img
            src={it.src}
            alt={it.caption || "screenshot"}
            onClick={() => onOpen(it.src)}
            style={{ width: "100%", display: "block", cursor: "zoom-in", maxHeight: 150, objectFit: "cover" }}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center", padding: 8 }}>
            {onCaption ? (
              <input
                value={it.caption}
                placeholder="caption…"
                onChange={(e) => onCaption(it.key, e.target.value)}
                style={{ ...homeInputStyle, fontSize: 12, padding: "6px 8px", flex: 1, minWidth: 0 }}
              />
            ) : (
              <span style={{ flex: 1, fontSize: 12, color: OWNER_THEME.muted, opacity: 0.75 }}>{it.caption}</span>
            )}
            <button type="button" onClick={() => onRemove(it.key)} style={dangerButton} title="Remove">
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function Newsletter() {
  const [week, setWeek] = useState<string>(() => mondayOf(todayStr()));
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [lightbox, setLightbox] = useState<string>("");

  // composer
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [day, setDay] = useState<string>(todayStr);
  const [pending, setPending] = useState<Pending[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // editing an existing idea
  const [editId, setEditId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const load = useCallback(async (w: string) => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`${API}?week=${encodeURIComponent(w)}`, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setIdeas(Array.isArray(data.ideas) ? data.ideas : []);
      setWeeks(Array.isArray(data.weeks) ? data.weeks : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setIdeas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(week); }, [week, load]);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data as { ok?: boolean; idea?: Idea; shot?: Shot };
  }, []);

  // ── composer actions ───────────────────────────────────────────────────────
  const stage = useCallback(async (files: File[]) => {
    const imgs = imagesFrom(files);
    if (!imgs.length) return;
    const staged = await Promise.all(imgs.map(async (f) => ({ key: uid(), dataUrl: await fileToDataUrl(f), caption: "" })));
    setPending((p) => [...p, ...staged]);
  }, []);

  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); void stage(files); }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    void stage(Array.from(e.dataTransfer?.files || []));
  };

  const save = async () => {
    if (!title.trim() && !body.trim() && !pending.length) return;
    setSaving(true);
    setErr("");
    try {
      const { idea } = await post({
        action: "create",
        title: title.trim(),
        body,
        day,
        shots: pending.map((p) => ({ dataUrl: p.dataUrl, caption: p.caption })),
      });
      setTitle("");
      setBody("");
      setPending([]);
      // Landed in a week you're not looking at → jump there so it isn't "lost".
      const w = idea?.week_start || mondayOf(day);
      if (week !== "all" && w !== week) setWeek(w);
      else await load(week);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // ── per-idea actions ───────────────────────────────────────────────────────
  const addShotTo = async (ideaId: number, files: File[]) => {
    const imgs = imagesFrom(files);
    if (!imgs.length) return;
    try {
      for (const f of imgs) {
        await post({ action: "addShot", ideaId, dataUrl: await fileToDataUrl(f), caption: "" });
      }
      await load(week);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const removeShot = async (id: number) => {
    setIdeas((p) => p.map((i) => ({ ...i, shots: i.shots.filter((s) => s.id !== id) })));
    try { await post({ action: "deleteShot", id }); } catch { await load(week); }
  };
  const captionShot = (id: number, caption: string) => {
    setIdeas((p) => p.map((i) => ({ ...i, shots: i.shots.map((s) => (s.id === id ? { ...s, caption } : s)) })));
    void post({ action: "shotCaption", id, caption }).catch(() => undefined);
  };
  const toggleUsed = async (idea: Idea) => {
    setIdeas((p) => p.map((i) => (i.id === idea.id ? { ...i, used: !i.used } : i)));
    try { await post({ action: "used", id: idea.id, used: !idea.used }); } catch { await load(week); }
  };
  const removeIdea = async (idea: Idea) => {
    if (!confirm(`Delete "${idea.title || "this idea"}"?`)) return;
    setIdeas((p) => p.filter((i) => i.id !== idea.id));
    try { await post({ action: "delete", id: idea.id }); } catch { await load(week); }
  };
  const startEdit = (idea: Idea) => {
    setEditId(idea.id);
    setEditTitle(idea.title);
    setEditBody(idea.body);
  };
  const commitEdit = async () => {
    if (editId == null) return;
    const id = editId;
    setIdeas((p) => p.map((i) => (i.id === id ? { ...i, title: editTitle, body: editBody } : i)));
    setEditId(null);
    try { await post({ action: "update", id, title: editTitle, body: editBody }); } catch { await load(week); }
  };

  // ── end-of-week export ─────────────────────────────────────────────────────
  const weekText = useMemo(() => {
    const head = week === "all" ? "All ideas" : `Week of ${fmtWeek(week)}`;
    const blocks = [...ideas]
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id - b.id))
      .map((i) => {
        const shots = i.shots.length
          ? `\n  screenshots: ${i.shots.map((s) => s.caption || "(no caption)").join(" · ")}`
          : "";
        return `${fmtDay(i.day)} — ${i.title || "(untitled)"}\n${i.body.trim() ? `  ${i.body.trim().replace(/\n/g, "\n  ")}` : "  (no notes)"}${shots}`;
      });
    return `${head}\n${"=".repeat(head.length)}\n\n${blocks.join("\n\n") || "(nothing captured)"}\n`;
  }, [ideas, week]);

  const copyWeek = async () => {
    try {
      await navigator.clipboard.writeText(weekText);
      alert("Week copied — paste it wherever you're drafting the letter.");
    } catch {
      setErr("Clipboard blocked — select the text manually.");
    }
  };
  const downloadWeek = () => {
    const blob = new Blob([weekText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `newsletter-ideas-${week}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shotCount = ideas.reduce((n, i) => n + i.shots.length, 0);
  const byDay = useMemo(() => {
    const m = new Map<string, Idea[]>();
    for (const i of ideas) m.set(i.day, [...(m.get(i.day) || []), i]);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [ideas]);

  return (
    <div style={homeShellStyle}>
      <div style={homeHeaderStyle}>
        <span style={{ fontSize: 17, fontWeight: 600, color: OWNER_THEME.text }}>Newsletter · Ideas</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={week} onChange={(e) => setWeek(e.target.value)} style={{ ...homeInputStyle, minWidth: 200 }}>
            <option value={mondayOf(todayStr())}>This week — {fmtWeek(mondayOf(todayStr()))}</option>
            {weeks
              .filter((w) => w.week !== mondayOf(todayStr()))
              .map((w) => (
                <option key={w.week} value={w.week}>
                  {fmtWeek(w.week)} · {w.n}
                </option>
              ))}
            <option value="all">All weeks</option>
          </select>
          <button type="button" onClick={() => void load(week)} style={smallButton}>
            Refresh
          </button>
          <button type="button" onClick={downloadWeek} style={homeSecondaryButtonStyle}>
            Download .txt
          </button>
          <button type="button" onClick={copyWeek} style={homeButtonStyle}>
            Copy week
          </button>
        </div>
      </div>

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
        {err && (
          <div
            style={{
              ...classicCardAccentStyle,
              padding: "10px 14px",
              fontSize: 13,
              color: OWNER_THEME.red,
              border: `1px solid ${rgba(OWNER_THEME.red, 0.4)}`,
            }}
          >
            {err}
          </div>
        )}

        {/* stat row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          {[
            { k: "Ideas", v: ideas.length },
            { k: "Screenshots", v: shotCount },
            { k: "Days covered", v: byDay.length },
            { k: "Already used", v: ideas.filter((i) => i.used).length },
          ].map((s) => (
            <div key={s.k} style={{ ...statTileStyle, padding: "12px 16px" }}>
              <div style={label}>{s.k}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: OWNER_THEME.text, marginTop: 4 }}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* composer */}
        <Card style={{ border: `1px solid ${rgba(LIGHT_BLUE, 0.28)}` }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ ...label, minWidth: 40 }}>Idea</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onPaste={onPaste}
              placeholder="One line — the thing you'd tell someone about"
              style={{ ...homeInputStyle, flex: 1, fontSize: 15, fontWeight: 600 }}
            />
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value || todayStr())}
              style={{ ...homeInputStyle, width: 150, colorScheme: "dark" }}
              title="Day this belongs to"
            />
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            placeholder="Type it out — what happened, the level, why it mattered, how you'd say it in the letter. Paste a screenshot right in here (Ctrl+V) or drop an image."
            style={areaStyle}
          />

          <div
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            style={{
              border: `1px dashed ${rgba(LIGHT_BLUE, 0.35)}`,
              borderRadius: 12,
              padding: pending.length ? 10 : 18,
              background: rgba(LIGHT_BLUE, 0.03),
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <Thumbs
              items={pending.map((p) => ({ key: p.key, src: p.dataUrl, caption: p.caption }))}
              onOpen={setLightbox}
              onRemove={(k) => setPending((p) => p.filter((x) => x.key !== k))}
              onCaption={(k, c) => setPending((p) => p.map((x) => (x.key === k ? { ...x, caption: c } : x)))}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{
                border: "none",
                background: "transparent",
                color: LIGHT_BLUE,
                cursor: "pointer",
                padding: pending.length ? "4px" : "10px",
                fontSize: 13,
                fontWeight: 700,
                alignSelf: "center",
              }}
            >
              ＋ Screenshot — click, drop, or paste
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => { void stage(Array.from(e.target.files || [])); e.target.value = ""; }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {(title || body || pending.length) && (
              <button type="button" onClick={() => { setTitle(""); setBody(""); setPending([]); }} style={smallButton}>
                Clear
              </button>
            )}
            <button type="button" onClick={save} disabled={saving} style={{ ...homeButtonStyle, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save idea"}
            </button>
          </div>
        </Card>

        {/* the week */}
        {loading ? (
          <div style={{ fontSize: 13, color: OWNER_THEME.muted, opacity: 0.6 }}>Loading…</div>
        ) : !ideas.length ? (
          <div style={{ fontSize: 13, color: OWNER_THEME.muted, opacity: 0.6 }}>
            Nothing captured for {week === "all" ? "any week" : fmtWeek(week)} yet — first idea goes above.
          </div>
        ) : (
          byDay.map(([d, list]) => (
            <div key={d} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: LIGHT_BLUE, letterSpacing: "0.04em" }}>{fmtDay(d)}</span>
                <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${rgba(LIGHT_BLUE, 0.35)}, transparent)` }} />
                <span style={{ fontSize: 11, color: OWNER_THEME.muted, opacity: 0.5 }}>{list.length}</span>
              </div>

              {list.map((idea) => (
                <Card key={idea.id} style={{ opacity: idea.used ? 0.62 : 1 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editId === idea.id ? (
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          style={{ ...homeInputStyle, width: "100%", fontSize: 15, fontWeight: 700 }}
                        />
                      ) : (
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: OWNER_THEME.text,
                            textDecoration: idea.used ? "line-through" : "none",
                          }}
                        >
                          {idea.title || "(untitled)"}
                        </div>
                      )}
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: OWNER_THEME.muted, cursor: "pointer" }}>
                      <input type="checkbox" checked={idea.used} onChange={() => void toggleUsed(idea)} />
                      used
                    </label>
                    {editId === idea.id ? (
                      <>
                        <button type="button" onClick={() => void commitEdit()} style={{ ...smallButton, color: LIGHT_BLUE }}>
                          Save
                        </button>
                        <button type="button" onClick={() => setEditId(null)} style={smallButton}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => startEdit(idea)} style={smallButton}>
                        Edit
                      </button>
                    )}
                    <button type="button" onClick={() => void removeIdea(idea)} style={dangerButton}>
                      ✕
                    </button>
                  </div>

                  {editId === idea.id ? (
                    <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} style={areaStyle} />
                  ) : (
                    idea.body.trim() && (
                      <div style={{ fontSize: 14, lineHeight: 1.65, color: OWNER_THEME.text, whiteSpace: "pre-wrap" }}>
                        {idea.body}
                      </div>
                    )
                  )}

                  <Thumbs
                    items={idea.shots.map((s) => ({ key: String(s.id), src: shotUrl(s.id), caption: s.caption }))}
                    onOpen={setLightbox}
                    onRemove={(k) => void removeShot(Number(k))}
                    onCaption={(k, c) => captionShot(Number(k), c)}
                  />

                  <label
                    style={{ ...smallButton, alignSelf: "flex-start", display: "inline-block" }}
                    onDrop={(e: DragEvent) => { e.preventDefault(); void addShotTo(idea.id, Array.from(e.dataTransfer?.files || [])); }}
                    onDragOver={(e: DragEvent) => e.preventDefault()}
                  >
                    ＋ Screenshot
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => { void addShotTo(idea.id, Array.from(e.target.files || [])); e.target.value = ""; }}
                    />
                  </label>
                </Card>
              ))}
            </div>
          ))
        )}
      </div>

      {lightbox && (
        <div
          onClick={() => setLightbox("")}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            zIndex: 60,
            cursor: "zoom-out",
          }}
        >
          <img
            src={lightbox}
            alt="screenshot"
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, border: `1px solid ${OWNER_THEME.border}` }}
          />
        </div>
      )}
    </div>
  );
}
