import type { Metadata, Viewport } from "next";
import Script from "next/script";
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
    <html lang="en" suppressHydrationWarning>
      <body className="flex h-screen flex-col overflow-hidden" suppressHydrationWarning>
        <Script id="x-pixel-base" strategy="afterInteractive">
          {`!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config','q57lo');`}
        </Script>
        <AuthProvider>
          <LayoutShell>{children}</LayoutShell>
        </AuthProvider>
      </body>
    </html>
  );
}
