import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import "./globals.css";
import LayoutShell from "@/components/shared/LayoutShell";

export const metadata: Metadata = {
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
      appearance={{ baseTheme: dark, variables: { colorPrimary: "#00F0FF" } }}
    >
      <html lang="en" suppressHydrationWarning>
        <body className="flex h-screen flex-col overflow-hidden" suppressHydrationWarning>
          <LayoutShell>{children}</LayoutShell>
        </body>
      </html>
    </ClerkProvider>
  );
}
