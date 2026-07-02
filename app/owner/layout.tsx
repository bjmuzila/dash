import OwnerGuard from "@/components/shared/ownerGuard";

// THE owner gate. Every route under /owner/* is owner-only via this single
// layout (defense-in-depth on top of the middleware redirect). The shared
// left rail (OwnerSidebar) is mounted once in LayoutShell for all owner +
// backend routes, so it isn't rendered here. New owner pages: drop a folder
// under app/owner/ — no per-page guard or nav wiring needed.
export const dynamic = "force-dynamic";

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <OwnerGuard>{children}</OwnerGuard>;
}
