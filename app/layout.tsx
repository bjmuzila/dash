import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
import { dark } from "@clerk/themes";
import "./globals.css";
import LayoutShell from "@/components/shared/LayoutShell";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://cbedge.net"),
  title: "CB Edge Dashboard",
  description: "Real Edge — Real Orderflow. Real-time SPX GEX & options flow dashboard.",
  openGraph: {
    title: "CB Edge Dashboard",
    description: "Real Edge — Real Orderflow. Real-time SPX GEX & options flow dashboard.",
    images: ["/og.png"], // ADD: place a 1200x630 image at /public/og.png
  },
  twitter: {
    card: "summary_large_image",
    title: "CB Edge Dashboard",
    description: "Real Edge — Real Orderflow. Real-time SPX GEX & options flow dashboard.",
    images: ["/og.png"],
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
    <ClerkProvider
      signUpUrl="/"
      appearance={{ baseTheme: dark, variables: { colorPrimary: "#219EBC" } }}
    >
      <html lang="en" className={inter.variable} suppressHydrationWarning>
        <body className="flex h-screen flex-col overflow-hidden" suppressHydrationWarning>
          <LayoutShell>{children}</LayoutShell>
        </body>
      </html>
    </ClerkProvider>
  );
}
