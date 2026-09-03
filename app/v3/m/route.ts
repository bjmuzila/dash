import { serveSpaShell } from "@/lib/serveSpaShell";

// /v3/m — the bare phone root. The SPA redirects it to MOBILE_DEFAULT_PATH
// (/v3/m/gex); this handler exists so that typing or sharing the short form
// resolves at all instead of 404ing before the SPA ever boots.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("v3");
