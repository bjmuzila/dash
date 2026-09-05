import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
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
 * Media Dump — the shoebox.
 *
 * Paste a screenshot (Ctrl+V anywhere on this page), drop a file on it, or pick
 * one. Give it a caption and it stays put. Later, when you want to mention that
 * thing, search for the words you captioned it with and copy the link.
 *
 * This replaced the Newsletter idea log. That page bucketed everything into
 * Monday-anchored weeks and hung screenshots off a parent "idea" — structure
 * that only made sense while a weekly letter was being written from it. The
 * part that was actually used was "keep this picture with a note on it", so the
 * ITEM is now the unit and the week is gone.
 *
 * Storage is POSTGRES, via /api/media-dump (owner-gated). Bytes never enter the
 * list JSON — each card's <img> pulls its own from /api/media-dump/file?id=N.
 * Nothing lives in localStorage, so this survives a cache clear and follows you
 * between machines.
 */

// ── model ────────────────────────────────────────────────────────────────────
type Item = {
  id: number;
  caption: string;
  note: string;
  tags: string[];
  kind: "image" | "file";
  mime: string;
  filename: string;
  byte_size: number;
  pinned: boolean;
  day: string; // YYYY-MM-DD
  created_at: string;
};
type TagRow = { tag: string; n: number };
/** A file staged in the composer, before it has a row. */
type Pending = { key: string; dataUrl: string; mime: string; filename: string; caption: string; bytes: number };

const API = "/api/media-dump";
const fileUrl = (id: number) => `${API}/file?id=${id}`;
const uid = () => Math.random().toString(36).slice(2, 10);

// ── formatting ───────────────────────────────────────────────────────────────
function fmtBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDay(ds: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds || "")) return ds || "";
  const d = new Date(`${ds}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// ── image handling — downscale before upload so a 4K screenshot isn't 6 MB ────
// Non-images (a PDF, a CSV) pass through untouched: there is nothing to scale
// and re-encoding them would destroy them.
const MAX_EDGE = 1800;
const JPEG_Q = 0.8;
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}
async function fileToDataUrl(file: File): Promise<string> {
  const src = await readAsDataUrl(file);
  if (!file.type.startsWith("image/")) return src;
  return new Promise((resolve) => {
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
  });
}
const approxBytes = (dataUrl: string) => Math.round(((dataUrl.split(",")[1] || "").length * 3) / 4);

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
  minHeight: 70,
  resize: "vertical",
  lineHeight: 1.6,
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const smallButton: CSSProperties = { ...homeSecondaryButtonStyle, padding: "6px 10px", fontSize: 12 };
const dangerButton: CSSProperties = {
  ...smallButton,
  color: OWNER_THEME.red,
  borderColor: rgba(OWNER_THEME.red, 0.4),
};
function chipStyle(on: boolean): CSSProperties {
  return {
    ...homeSecondaryButtonStyle,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 700,
    borderColor: on ? rgba(LIGHT_BLUE, 0.55) : OWNER_THEME.border,
    color: on ? LIGHT_BLUE : OWNER_THEME.muted,
    background: on ? rgba(LIGHT_BLUE, 0.1) : "transparent",
  };
}

function Card({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ ...classicCardAccentStyle, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, ...style }}>
      {children}
    </div>
  );
}

/** What a non-image row shows where the thumbnail would be. */
function FileGlyph({ mime, name }: { mime: string; name: string }) {
  const ext = (name.split(".").pop() || mime.split("/")[1] || "file").slice(0, 5).toUpperCase();
  return (
    <div
      style={{
        height: 150,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        background: rgba(LIGHT_BLUE, 0.05),
      }}
    >
      <span style={{ fontSize: 26, opacity: 0.7 }}>🗎</span>
      <span style={{ ...label, color: OWNER_THEME.muted }}>{ext}</span>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function MediaDump() {
  const [items, setItems] = useState<Item[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState("");

  // filters
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tag, setTag] = useState("");

  // composer
  const [pending, setPending] = useState<Pending[]>([]);
  const [batchTags, setBatchTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // viewing
  const [lightbox, setLightbox] = useState<Item | null>(null);
  const [openNote, setOpenNote] = useState<number | null>(null);

  const say = useCallback((m: string) => {
    setFlash(m);
    window.setTimeout(() => setFlash((cur) => (cur === m ? "" : cur)), 2200);
  }, []);

  // ── load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async (search: string, onlyTag: string) => {
    setLoading(true);
    setErr("");
    try {
      const url = new URL(API, window.location.origin);
      if (search) url.searchParams.set("q", search);
      if (onlyTag) url.searchParams.set("tag", onlyTag);
      const r = await fetch(url.pathname + url.search, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setTags(Array.isArray(data.tags) ? data.tags : []);
      setTotal(Number(data.total || 0));
      setTotalBytes(Number(data.totalBytes || 0));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(debouncedQ, tag); }, [debouncedQ, tag, load]);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data as { ok?: boolean; items?: Item[]; item?: Item; rejected?: number };
  }, []);

  // ── staging ────────────────────────────────────────────────────────────────
  const stage = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const staged: Pending[] = [];
    for (const f of files.slice(0, 24)) {
      const dataUrl = await fileToDataUrl(f);
      staged.push({
        key: uid(),
        dataUrl,
        mime: f.type || "application/octet-stream",
        filename: f.name || "",
        caption: "",
        bytes: approxBytes(dataUrl),
      });
    }
    setPending((p) => [...p, ...staged]);
  }, []);

  // Paste anywhere on the page. A screenshot in the clipboard is the whole
  // point of this page, so it must not require clicking into a box first — but
  // a plain text paste into an input has to keep working, hence the file test.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items || [])
        .filter((i) => i.kind === "file")
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (!files.length) return;
      e.preventDefault();
      void stage(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [stage]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void stage(Array.from(e.dataTransfer?.files || []));
  };

  const save = async () => {
    if (!pending.length) return;
    setSaving(true);
    setErr("");
    try {
      const res = await post({
        action: "create",
        tags: batchTags,
        items: pending.map((p) => ({ dataUrl: p.dataUrl, caption: p.caption.trim(), filename: p.filename })),
      });
      setPending([]);
      setBatchTags("");
      say(`Saved ${res.items?.length ?? 0}${res.rejected ? ` · ${res.rejected} too big` : ""}`);
      await load(debouncedQ, tag);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // ── per-item actions ───────────────────────────────────────────────────────
  const patch = (id: number, next: Partial<Item>) =>
    setItems((p) => p.map((i) => (i.id === id ? { ...i, ...next } : i)));

  const editField = (id: number, field: "caption" | "note", value: string) => {
    patch(id, { [field]: value } as Partial<Item>);
  };
  const commitField = (id: number, field: "caption" | "note", value: string) => {
    void post({ action: "update", id, [field]: value }).catch((e) => setErr(String(e)));
  };
  const commitTags = (id: number, raw: string) => {
    const next = raw.split(",").map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean);
    patch(id, { tags: next });
    void post({ action: "update", id, tags: next })
      .then(() => load(debouncedQ, tag))
      .catch((e) => setErr(String(e)));
  };
  const togglePin = (it: Item) => {
    patch(it.id, { pinned: !it.pinned });
    void post({ action: "pin", id: it.id, pinned: !it.pinned })
      .then(() => load(debouncedQ, tag))
      .catch(() => load(debouncedQ, tag));
  };
  const remove = async (it: Item) => {
    if (!confirm(`Delete "${it.caption || it.filename || `#${it.id}`}"? The file goes with it.`)) return;
    setItems((p) => p.filter((x) => x.id !== it.id));
    try {
      await post({ action: "delete", id: it.id });
      setTotal((n) => Math.max(0, n - 1));
    } catch {
      await load(debouncedQ, tag);
    }
  };

  // ── mentioning it later ────────────────────────────────────────────────────
  const absUrl = (it: Item) => `${window.location.origin}${fileUrl(it.id)}`;
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      say(`${what} copied`);
    } catch {
      setErr("Clipboard blocked by the browser — copy it by hand.");
    }
  };
  const copyLink = (it: Item) => void copy(absUrl(it), "Link");
  const copyRef = (it: Item) =>
    void copy(`![${it.caption || it.filename || `media ${it.id}`}](${absUrl(it)})`, "Markdown");

  // ── derived ────────────────────────────────────────────────────────────────
  const shown = items.length;
  const pendingBytes = pending.reduce((n, p) => n + p.bytes, 0);
  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) m.set(i.day, [...(m.get(i.day) || []), i]);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [items]);

  // Lightbox: Esc closes, ←/→ walk the (image) items in view order.
  const imageItems = useMemo(() => items.filter((i) => i.kind === "image"), [items]);
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setLightbox(null); return; }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const idx = imageItems.findIndex((i) => i.id === lightbox.id);
      if (idx < 0) return;
      const next = imageItems[(idx + (e.key === "ArrowRight" ? 1 : imageItems.length - 1)) % imageItems.length];
      if (next) setLightbox(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, imageItems]);

  return (
    <div
      style={{ ...homeShellStyle, position: "relative" }}
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
    >
      <div style={homeHeaderStyle}>
        <span style={{ fontSize: 17, fontWeight: 600, color: OWNER_THEME.text }}>Media Dump</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search captions, notes, filenames…"
            style={{ ...homeInputStyle, minWidth: 260 }}
          />
          {tag && (
            <button type="button" onClick={() => setTag("")} style={chipStyle(true)}>
              #{tag} ✕
            </button>
          )}
          <button type="button" onClick={() => void load(debouncedQ, tag)} style={smallButton}>
            Refresh
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} style={homeButtonStyle}>
            ＋ Add media
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => { void stage(Array.from(e.target.files || [])); e.target.value = ""; }}
          />
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
            { k: "In the dump", v: String(total) },
            { k: "Showing", v: String(shown) },
            { k: "Pinned", v: String(items.filter((i) => i.pinned).length) },
            { k: "Stored", v: fmtBytes(totalBytes) },
          ].map((s) => (
            <div key={s.k} style={{ ...statTileStyle, padding: "12px 16px" }}>
              <div style={label}>{s.k}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: OWNER_THEME.text, marginTop: 4 }}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* composer — only takes up room once something is staged */}
        <Card style={{ border: `1px solid ${rgba(LIGHT_BLUE, pending.length ? 0.4 : 0.24)}` }}>
          {!pending.length ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{
                border: `1px dashed ${rgba(LIGHT_BLUE, 0.35)}`,
                borderRadius: 12,
                background: rgba(LIGHT_BLUE, 0.03),
                color: LIGHT_BLUE,
                cursor: "pointer",
                padding: "20px 12px",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Paste a screenshot (Ctrl+V), drop a file anywhere on this page, or click to pick one
            </button>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={label}>
                  {pending.length} staged · {fmtBytes(pendingBytes)}
                </span>
                <input
                  value={batchTags}
                  onChange={(e) => setBatchTags(e.target.value)}
                  placeholder="tags for this batch — comma separated"
                  style={{ ...homeInputStyle, flex: 1, minWidth: 200, fontSize: 12 }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
                {pending.map((p) => (
                  <div
                    key={p.key}
                    style={{
                      border: `1px solid ${OWNER_THEME.border}`,
                      borderRadius: 12,
                      overflow: "hidden",
                      background: rgba(LIGHT_BLUE, 0.03),
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    {p.mime.startsWith("image/") ? (
                      <img
                        src={p.dataUrl}
                        alt={p.filename || "staged"}
                        style={{ width: "100%", display: "block", maxHeight: 150, objectFit: "cover" }}
                      />
                    ) : (
                      <FileGlyph mime={p.mime} name={p.filename} />
                    )}
                    <div style={{ display: "flex", gap: 6, alignItems: "center", padding: 8 }}>
                      <input
                        value={p.caption}
                        placeholder="caption — what is this?"
                        autoFocus={pending[pending.length - 1]?.key === p.key}
                        onChange={(e) =>
                          setPending((all) => all.map((x) => (x.key === p.key ? { ...x, caption: e.target.value } : x)))
                        }
                        onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
                        style={{ ...homeInputStyle, fontSize: 12, padding: "6px 8px", flex: 1, minWidth: 0 }}
                      />
                      <button
                        type="button"
                        onClick={() => setPending((all) => all.filter((x) => x.key !== p.key))}
                        style={dangerButton}
                        title="Discard"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" onClick={() => { setPending([]); setBatchTags(""); }} style={smallButton}>
                  Discard all
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  style={{ ...homeButtonStyle, opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? "Saving…" : `Keep ${pending.length}`}
                </button>
              </div>
            </>
          )}
        </Card>

        {/* tag rail */}
        {tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ ...label, marginRight: 4 }}>Tags</span>
            {tags.map((t) => (
              <button
                key={t.tag}
                type="button"
                onClick={() => setTag(tag === t.tag ? "" : t.tag)}
                style={chipStyle(tag === t.tag)}
              >
                #{t.tag} · {t.n}
              </button>
            ))}
          </div>
        )}

        {/* the dump */}
        {loading ? (
          <div style={{ fontSize: 13, color: OWNER_THEME.muted, opacity: 0.6 }}>Loading…</div>
        ) : !items.length ? (
          <div style={{ fontSize: 13, color: OWNER_THEME.muted, opacity: 0.6 }}>
            {debouncedQ || tag ? "Nothing matches that." : "Empty. Paste a screenshot to start the pile."}
          </div>
        ) : (
          byDay.map(([d, list]) => (
            <div key={d} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: LIGHT_BLUE, letterSpacing: "0.04em" }}>{fmtDay(d)}</span>
                <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${rgba(LIGHT_BLUE, 0.35)}, transparent)` }} />
                <span style={{ fontSize: 11, color: OWNER_THEME.muted, opacity: 0.5 }}>{list.length}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
                {list.map((it) => (
                  <Card
                    key={it.id}
                    style={{
                      padding: 0,
                      gap: 0,
                      overflow: "hidden",
                      border: `1px solid ${it.pinned ? rgba(LIGHT_BLUE, 0.5) : OWNER_THEME.border}`,
                    }}
                  >
                    {it.kind === "image" ? (
                      <img
                        src={fileUrl(it.id)}
                        alt={it.caption || it.filename || "media"}
                        loading="lazy"
                        onClick={() => setLightbox(it)}
                        style={{ width: "100%", display: "block", maxHeight: 190, objectFit: "cover", cursor: "zoom-in" }}
                      />
                    ) : (
                      <a href={fileUrl(it.id)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                        <FileGlyph mime={it.mime} name={it.filename} />
                      </a>
                    )}

                    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                      <input
                        value={it.caption}
                        placeholder="caption…"
                        onChange={(e) => editField(it.id, "caption", e.target.value)}
                        onBlur={(e) => commitField(it.id, "caption", e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        style={{ ...homeInputStyle, fontSize: 13, fontWeight: 600, padding: "6px 8px" }}
                      />

                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {it.tags.map((t) => (
                          <button key={t} type="button" onClick={() => setTag(t)} style={chipStyle(false)}>
                            #{t}
                          </button>
                        ))}
                        <input
                          defaultValue=""
                          placeholder={it.tags.length ? "+ tag" : "add tags…"}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            const el = e.target as HTMLInputElement;
                            const raw = el.value.trim();
                            if (!raw) return;
                            commitTags(it.id, [...it.tags, raw].join(","));
                            el.value = "";
                          }}
                          style={{ ...homeInputStyle, fontSize: 11, padding: "4px 8px", width: 92 }}
                        />
                      </div>

                      {openNote === it.id ? (
                        <textarea
                          value={it.note}
                          autoFocus
                          placeholder="Anything you'd want to remember when you bring this up later…"
                          onChange={(e) => editField(it.id, "note", e.target.value)}
                          onBlur={(e) => { commitField(it.id, "note", e.target.value); setOpenNote(null); }}
                          style={areaStyle}
                        />
                      ) : (
                        it.note.trim() && (
                          <div
                            onClick={() => setOpenNote(it.id)}
                            style={{
                              fontSize: 12,
                              lineHeight: 1.6,
                              color: OWNER_THEME.muted,
                              whiteSpace: "pre-wrap",
                              cursor: "text",
                            }}
                          >
                            {it.note}
                          </div>
                        )
                      )}

                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <button type="button" onClick={() => togglePin(it)} style={chipStyle(it.pinned)} title="Pin to the top">
                          {it.pinned ? "★ pinned" : "☆ pin"}
                        </button>
                        {openNote !== it.id && !it.note.trim() && (
                          <button type="button" onClick={() => setOpenNote(it.id)} style={smallButton}>
                            Note
                          </button>
                        )}
                        <button type="button" onClick={() => copyLink(it)} style={smallButton} title="Copy a link to this file">
                          Link
                        </button>
                        <button type="button" onClick={() => copyRef(it)} style={smallButton} title="Copy as markdown">
                          MD
                        </button>
                        <a href={`${fileUrl(it.id)}&download=1`} style={{ ...smallButton, textDecoration: "none" }}>
                          Save
                        </a>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 10, color: OWNER_THEME.muted, opacity: 0.5 }}>{fmtBytes(it.byte_size)}</span>
                        <button type="button" onClick={() => void remove(it)} style={dangerButton} title="Delete">
                          ✕
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* drop overlay */}
      {dragging && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 40,
            background: rgba(LIGHT_BLUE, 0.08),
            border: `2px dashed ${rgba(LIGHT_BLUE, 0.6)}`,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 800,
            color: LIGHT_BLUE,
            pointerEvents: "none",
          }}
        >
          Drop it — it'll wait here for a caption
        </div>
      )}

      {/* toast */}
      {flash && (
        <div
          style={{
            position: "absolute",
            bottom: 18,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 55,
            padding: "8px 16px",
            borderRadius: 999,
            background: OWNER_THEME.panel,
            border: `1px solid ${rgba(LIGHT_BLUE, 0.45)}`,
            color: LIGHT_BLUE,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {flash}
        </div>
      )}

      {/* lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 28,
            zIndex: 60,
            cursor: "zoom-out",
          }}
        >
          <img
            src={fileUrl(lightbox.id)}
            alt={lightbox.caption || "media"}
            style={{ maxWidth: "100%", maxHeight: "82%", borderRadius: 12, border: `1px solid ${OWNER_THEME.border}` }}
          />
          <div style={{ fontSize: 13, color: OWNER_THEME.text, textAlign: "center", maxWidth: 700 }}>
            {lightbox.caption || <span style={{ opacity: 0.5 }}>(no caption)</span>}
            {lightbox.note.trim() && (
              <div style={{ fontSize: 12, color: OWNER_THEME.muted, marginTop: 6, whiteSpace: "pre-wrap" }}>{lightbox.note}</div>
            )}
          </div>
          <div style={{ fontSize: 11, color: OWNER_THEME.muted, opacity: 0.5 }}>← → to walk · Esc to close</div>
        </div>
      )}
    </div>
  );
}
