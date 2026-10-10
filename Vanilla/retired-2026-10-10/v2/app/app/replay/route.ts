import { serveSpaShell } from "@/lib/serveSpaShell";
// /app/replay — SPA route (app-vite/src/App.tsx mounts <Replay />). Every SPA
// route needs its own handler so a hard refresh or a pasted link on this URL
// serves the shell instead of falling through to the Next 404.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("app");
