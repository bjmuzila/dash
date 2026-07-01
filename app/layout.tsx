import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import LayoutShell from "@/components/shared/LayoutShell";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://cbedge.net"),
  title: "CB Edge — Real-Time SPX GEX, Options Flow & Key Levels",
  description: "Real Edge — Real Orderflow. Real-time SPX GEX & options flow dashboard.",
  openGraph: {
    siteName: "CB Edge",
    title: "CB Edge — Real-Time SPX GEX, Options Flow & Key Levels",
    description: "Real Edge — Real Orderflow. Real-time SPX GEX & options flow dashboard.",
  },
  twitter: {
    card: "summary_large_image",
    title: "CB Edge — Real-Time SPX GEX, Options Flow & Key Levels",
    description: "Real Edge — Real Orderflow. Real-time SPX GEX & options flow dashboard.",
  },
  verification: {
    google: "QcoYk0isEwvk7zC8sMlcBCFqZpI24vvukYjBRmTGmd0",
  },
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
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="flex h-screen flex-col overflow-hidden" suppressHydrationWarning>
        <AuthProvider>
          <LayoutShell>{children}</LayoutShell>
        </AuthProvider>
      </body>
    </html>
  );
}
