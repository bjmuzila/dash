import { serveSpaShell } from "@/lib/serveSpaShell";
// The customer dashboard SPA (app-vite). Client routing owns the sub-paths;
// this bare entry just boots the shell, which redirects to /app/traders-dashboard.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("app");
