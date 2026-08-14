import { serveSpaShell } from "@/lib/serveSpaShell";
// /app/strike-history — SPA route (app-vite/src/App.tsx mounts <StrikeHistory />).
// Same reason as every other handler in this folder: without it a hard refresh
// on this URL 404s from Next instead of booting the SPA shell.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("app");
