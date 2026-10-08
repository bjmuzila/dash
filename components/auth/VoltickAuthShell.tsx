import type { ReactNode } from "react";

/**
 * The Voltick frame for CB Edge's auth pages (sign-in, set/reset password) when
 * the person is on their way to vela.cbedge.net. Vela is a Voltick product that
 * happens to sign in with a CB Edge account, so a beta tester should never see
 * the CB Edge lockup on the way in.
 *
 * Palette is Voltick's, the same values as deploy/vela/denied.html and
 * lib/emails/vela-invite.ts: ink #0a0d10 · panel #0e1216 · line #1e2630 ·
 * paper #e7ece9 · Volt Blue #2f6bff · accent #6aa0ff. No grey text.
 * The bolt is public/voltick-bolt.png (also the logo in the invite email).
 */

const VELA_ORIGIN = "https://vela.cbedge.net";

/** Is this `next` (already, or about to be, sanitised by AuthForm) a Vela URL? */
export function isVelaNext(next: string | null | undefined): boolean {
  if (!next) return false;
  try {
    const u = new URL(next);
    return u.protocol === "https:" && u.origin === VELA_ORIGIN;
  } catch {
    return false;
  }
}

export function VoltickAuthShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        overflowY: "auto",
        background:
          "radial-gradient(1100px 520px at 10% -12%, rgba(47,107,255,0.26), transparent 60%)," +
          "radial-gradient(880px 460px at 92% -6%, rgba(77,140,255,0.18), transparent 62%)," +
          "#0a0d10",
        colorScheme: "dark",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: "100%", maxWidth: 440 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/voltick-bolt.png" alt="" width={34} height={34} style={{ display: "block" }} />
          <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.01em", color: "#e7ece9" }}>Voltick</span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#6aa0ff",
              border: "1px solid #2f6bff66",
              borderRadius: 99,
              padding: "3px 9px",
            }}
          >
            Vela charts
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
