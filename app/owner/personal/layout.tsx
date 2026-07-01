import OwnerGuard from "@/components/shared/ownerGuard";

// All /personal/* routes are owner-only. Guarded server-side here in addition
// to the middleware redirect.
export const dynamic = "force-dynamic";

export default function PersonalLayout({ children }: { children: React.ReactNode }) {
  return <OwnerGuard>{children}</OwnerGuard>;
}
