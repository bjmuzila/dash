import OwnerGuard from "@/components/shared/ownerGuard";

// All /dev/* routes (owner, admin, tree, dev index) are owner-only. Guarded
// server-side here in addition to the middleware redirect.
export const dynamic = "force-dynamic";

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return <OwnerGuard>{children}</OwnerGuard>;
}
