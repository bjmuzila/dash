import type { Metadata } from "next";
import "./globals.css";
import TopBar from "@/components/shared/TopBar";
import LayoutShell from "@/components/shared/LayoutShell";

export const metadata: Metadata = {
  title: "BzilaTrades Dashboard",
  description: "Real-time SPX GEX & options flow dashboard",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex h-screen flex-col overflow-hidden">
        <TopBar />
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
