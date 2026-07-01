import OwnerGuard from "@/components/shared/ownerGuard";

export const dynamic = "force-dynamic";

export default function MarketScannerLayout({ children }: { children: React.ReactNode }) {
  return <OwnerGuard>{children}</OwnerGuard>;
}
