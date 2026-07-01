"use client";

/**
 * /owner — landing page for the owner group. One tile per owner/backend tool,
 * grouped the same way as the sidebar (single source of truth:
 * OWNER_SIDEBAR_GROUPS in components/shared/OwnerSidebar.tsx).
 */

import Link from "next/link";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { OWNER_SIDEBAR_GROUPS } from "@/components/shared/OwnerSidebar";

const ACCENT_NAME: Record<string, string> = {
  [HOME_THEME.cyan]: "cyan",
  [HOME_THEME.orange]: "orange",
  [HOME_THEME.green]: "green",
};

export default function OwnerHubPage() {
  return (
    <PageShell>
      <Card
        accent="cyan"
        title="Owner Hub"
        subtitle="Everything behind the owner gate — dashboards, backend tools, and personal pages."
      >
        <p style={{ fontSize: 13, color: HOME_THEME.text, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>
          All routes under /owner are gated once by the owner layout. Add a new page under
          app/owner/ and it is automatically owner-only and listed in the sidebar config.
        </p>
      </Card>

      {OWNER_SIDEBAR_GROUPS.map((group) => (
        <Card key={group.label} accent={ACCENT_NAME[group.accent] ?? group.accent} title={group.label}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 10,
            }}
          >
            {group.links
              .filter((l) => l.href !== "/owner")
              .map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "14px 14px",
                    borderRadius: 10,
                    textDecoration: "none",
                    color: HOME_THEME.text,
                    background: `${group.accent}12`,
                    border: `1px solid ${group.accent}33`,
                  }}
                >
                  <span aria-hidden style={{ fontSize: 16, width: 20, textAlign: "center", color: group.accent }}>
                    {link.glyph}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                    {link.label}
                  </span>
                </Link>
              ))}
          </div>
        </Card>
      ))}
    </PageShell>
  );
}
