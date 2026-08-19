import { serveSpaShell } from "@/lib/serveSpaShell";

// Dashboard v3 (cbedge-v3 → public/v3). Owner-only via middleware.ts until it
// ships. v2 keeps /app/* untouched; the two run side by side.
//
// Deliberately NOT a catch-all ([[...slug]]): a catch-all here would swallow
// /v3/assets/*.js and hand back HTML. Same reason every /app/* route has its
// own three-line handler. When v3 gains a route, add app/v3/<name>/route.ts
// alongside this one.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("v3");
