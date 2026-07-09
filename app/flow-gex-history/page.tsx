"use client";

import { PageShell } from "@/components/shared/PageCard";
import { FlowGexHistoryPanel } from "@/components/dashboard/FlowGexHistoryPanel";

export default function FlowGexHistoryPage() {
  return (
    <PageShell>
      <FlowGexHistoryPanel />
    </PageShell>
  );
}
