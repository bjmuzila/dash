import OwnerGuard from "@/components/shared/ownerGuard";

// /budget is owner-only. Guarded server-side here in addition to the middleware
// redirect and the budget API's own owner gate.
export const dynamic = "force-dynamic";

export default function BudgetLayout({ children }: { children: React.ReactNode }) {
  return <OwnerGuard>{children}</OwnerGuard>;
}
