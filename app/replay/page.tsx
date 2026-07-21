// /replay — standalone Option-chain GEX replay. Thin wrapper around the shared
// <ChainReplay> component (also mounted as the Options Chain "▶ Replay" modal).

"use client";

import { LIGHT_BLUE } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ChainReplay } from "@/components/shared/ChainReplay";

export default function ReplayPage() {
  return (
    <PageShell>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="Option Chain Replay"
        subtitle="Play back the recorded per-strike net-GEX profile through the session."
      >
        <ChainReplay embedded symbol="MSFT" />
      </Card>
    </PageShell>
  );
}
