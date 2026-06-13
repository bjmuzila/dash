"use client";

/**
 * Personal Logs — telemetry logs + concept ideas.
 * Full React port of pages/old/logs.html. Persists via /api/personal-logs proxy.
 */

import { useCallback, useEffect, useState } from "react";

interface LogEntry { id: number; content: string; timestamp: string; type?: string }

function getTimestamp(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toTimeString().split(" ")[0].slice(0, 5);
  return `${date} @ ${time}`;
}

function EntryCard({ entry, accent, onDelete }: { entry: LogEntry; accent: string; onDelete: () => void }) {
  return (
    <div style={{
      border: `1px solid ${accent}33`, background: `${accent}0b`,
      borderRadius: 4, padding: 10, borderLeft: `3px solid ${accent}80`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={{ fontSize: 10, color: accent, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{entry.timestamp}</div>
        <button onClick={onDelete} style={{ background: "none", border: "none", color: "#3a5570", cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
      </div>
      <div style={{ fontSize: 12, color: "#a8b8cc", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{entry.content}</div>
    </div>
  );
}

function Column({
  title, icon, accent, countLabel, entries, placeholder, buttonLabel, onSave, onDelete,
}: {
  title: string; icon: string; accent: string; countLabel: (n: number) => string;
  entries: LogEntry[]; placeholder: string; buttonLabel: string;
  onSave: (text: string) => Promise<void>; onDelete: (id: number) => void;
}) {
  const [text, setText] = useState("");

  const save = async () => {
    const t = text.trim();
    if (!t) return;
    await onSave(t);
    setText("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <div style={{ flexShrink: 0, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: ".15em", textTransform: "uppercase" }}>
            {icon} {title}
          </div>
          <div style={{
            fontSize: 10, fontWeight: 800, color: "#e8edf5",
            background: `${accent}33`, border: `1px solid ${accent}66`,
            padding: "3px 8px", borderRadius: 3,
          }}>
            {countLabel(entries.length)}
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.ctrlKey && e.key === "Enter") save(); }}
          placeholder={placeholder}
          style={{
            width: "100%", height: 80, background: "rgba(0,0,0,.4)",
            border: "1px solid #1e3050", borderRadius: 4, padding: 10,
            color: "#e8edf5", fontSize: 12, fontFamily: "monospace",
            resize: "none", outline: "none", boxSizing: "border-box",
          }}
        />
        <button
          onClick={save}
          style={{
            width: "100%", marginTop: 10, padding: 10,
            background: `${accent}26`, border: `1px solid ${accent}66`,
            color: accent, fontSize: 11, fontWeight: 800, letterSpacing: ".12em",
            cursor: "pointer", borderRadius: 4, textTransform: "uppercase",
          }}
        >
          {buttonLabel}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: 8 }}>
        {entries.map((e) => (
          <EntryCard key={e.id} entry={e} accent={accent} onDelete={() => onDelete(e.id)} />
        ))}
      </div>
    </div>
  );
}

export default function LogsPage() {
  const [telemetry, setTelemetry] = useState<LogEntry[]>([]);
  const [ideas, setIdeas] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/personal-logs", { cache: "no-store" });
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      const data = await res.json();
      setTelemetry(data.telemetry ?? []);
      setIdeas(data.ideas ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveEntry = (kind: "telemetry" | "ideas", type: string) => async (text: string) => {
    const entry = { type, content: text, timestamp: getTimestamp(), id: Date.now() };
    const res = await fetch(`/api/personal-logs/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!res.ok) { alert(`Failed to save ${type}`); return; }
    await load();
  };

  const deleteEntry = (type: "telemetry" | "idea") => async (id: number) => {
    if (!confirm("Delete this entry?")) return;
    const res = await fetch(`/api/personal-logs/${type}/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Failed to delete entry"); return; }
    await load();
  };

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden", background: "#070b11" }}>
      <div style={{
        padding: "14px 20px", background: "#0a0f16", borderBottom: "1px solid #1e3050",
        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#00e5ff", letterSpacing: ".15em", textTransform: "uppercase" }}>
          📝 Personal Logs
        </div>
        {error && <div style={{ fontSize: 10, color: "#ff4757" }}>Proxy offline — {error}</div>}
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: 0, overflow: "hidden", gap: 20, padding: 20 }}>
        <Column
          title="Telemetry Logs" icon="🔹" accent="#00e5ff"
          countLabel={(n) => `${n} RECORD${n !== 1 ? "S" : ""}`}
          entries={telemetry}
          placeholder="Input operational log telemetry... [Ctrl + Enter to send]"
          buttonLabel="💾 Commit Log"
          onSave={saveEntry("telemetry", "telemetry")}
          onDelete={deleteEntry("telemetry")}
        />
        <Column
          title="Concept Ideas" icon="💡" accent="#ffb300"
          countLabel={(n) => `${n} BLUEPRINT${n !== 1 ? "S" : ""}`}
          entries={ideas}
          placeholder="Jot down creative blueprint concept... [Ctrl + Enter to send]"
          buttonLabel="✨ Save Idea"
          onSave={saveEntry("ideas", "idea")}
          onDelete={deleteEntry("idea")}
        />
      </div>
    </div>
  );
}
