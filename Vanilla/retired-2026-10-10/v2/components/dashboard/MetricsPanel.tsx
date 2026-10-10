"use client";

interface Metric {
  label: string;
  value: string | number;
  color?: string;
}

interface MetricsPanelProps {
  metrics?: Metric[];
}

export default function MetricsPanel({ metrics = [] }: MetricsPanelProps) {
  return (
    <div className="rounded border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--accent)" }}>Metrics</h2>
      <div className="grid grid-cols-2 gap-2">
        {metrics.length === 0 ? (
          <p className="text-xs col-span-2" style={{ color: "var(--muted)" }}>No metrics yet.</p>
        ) : (
          metrics.map((m) => (
            <div key={m.label}>
              <div className="text-xs" style={{ color: "var(--muted)" }}>{m.label}</div>
              <div className="text-sm font-mono" style={{ color: m.color ?? "var(--text)" }}>{m.value}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
