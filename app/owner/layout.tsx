import OwnerGuard from "@/components/shared/ownerGuard";
import OwnerSidebar from "@/components/shared/OwnerSidebar";

// THE owner gate. Every route under /owner/* is owner-only via this single
// layout (defense-in-depth on top of the middleware redirect) and gets the
// shared OwnerSidebar. New owner pages: drop a folder under app/owner/ —
// no per-page guard or nav wiring needed.
export const dynamic = "force-dynamic";

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <OwnerGuard>
      <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
        <OwnerSidebar />
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {children}
        </div>
      </div>
    </OwnerGuard>
  );
}
