import type { Metadata, Viewport } from "next";
import "./globals.css";
import LayoutShell from "@/components/shared/LayoutShell";

export const metadata: Metadata = {
  title: "BzilaTrades Dashboard",
  description: "Real-time SPX GEX & options flow dashboard",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex h-screen flex-col overflow-hidden">
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
