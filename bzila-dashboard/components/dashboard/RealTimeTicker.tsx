"use client";

import { useEffect, useState } from "react";

interface TickerProps {
  symbol?: string;
}

export default function RealTimeTicker({ symbol = "SPX" }: TickerProps) {
  const [price, setPrice] = useState<number | null>(null);
  const [change, setChange] = useState<number>(0);

  // TODO: connect to useTastytradeStream hook
  useEffect(() => {
    // placeholder — replace with real stream subscription
    const t = setInterval(() => {
      setPrice((p) => (p ?? 5400) + (Math.random() - 0.5) * 2);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const up = change >= 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span style={{ color: "var(--muted)" }}>{symbol}</span>
      <span className="text-base font-mono" style={{ color: up ? "var(--accent)" : "var(--red)" }}>
        {price?.toFixed(2) ?? "—"}
      </span>
      <span style={{ color: up ? "var(--accent)" : "var(--red)" }}>
        {up ? "▲" : "▼"} {Math.abs(change).toFixed(2)}
      </span>
    </div>
  );
}
