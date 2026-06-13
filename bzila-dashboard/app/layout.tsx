import type { Metadata } from "next";
import "./globals.css";
import TopBar from "@/components/shared/TopBar";
import Sidebar from "@/components/shared/Sidebar";

export const metadata: Metadata = {
  title: "BzilaTrades Dashboard",
  description: "Real-time SPX GEX & options flow dashboard",
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
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-hidden" style={{ display: "flex", flexDirection: "column" }}>{children}</main>
        </div>
      </body>
    </html>
  );
}
