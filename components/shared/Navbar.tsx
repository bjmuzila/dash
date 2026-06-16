"use client";

import Image from "next/image";
import Link from "next/link";

export default function Navbar() {
  return (
    <header
      className="flex items-center justify-between px-4 py-2 border-b"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <Link href="/home" className="flex items-center gap-2">
        <Image
          src="/bzilatrades-logo.png"
          alt="BzilaTrades"
          width={32}
          height={32}
          priority
        />
        <span className="text-sm font-semibold tracking-widest uppercase" style={{ color: "var(--accent)" }}>
          BzilaTrades
        </span>
      </Link>

      <div className="flex items-center gap-4 text-xs" style={{ color: "var(--muted)" }}>
        {/* Live clock — will be wired up once RealTimeTicker exists */}
        <span id="navbar-clock" suppressHydrationWarning />
        <span className="px-2 py-0.5 rounded text-xs" style={{ background: "#1a2a1a", color: "var(--accent)" }}>
          LIVE
        </span>
      </div>
    </header>
  );
}
