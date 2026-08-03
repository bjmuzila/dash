import { serveSpaShell } from "@/lib/serveSpaShell";
// Phone build of the dashboard — see components/mobile/mobileNav.ts. Each SPA
// route needs its own handler so a hard refresh or a shared link on this URL
// serves the shell instead of 404ing.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("app");
