import OwnerGuard from "@/components/shared/ownerGuard";

// All /admin/* routes are owner-only. Guarded server-side here (defense-in-depth
// on top of the middleware redirect), mirroring /dev/layout.tsx.
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <OwnerGuard>{children}</OwnerGuard>;
}
