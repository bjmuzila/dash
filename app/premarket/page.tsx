/**
 * /premarket — Next-side stub.
 *
 * The real page is a LIVE-FEED page: it rides lib/gexSocket through
 * useMobileGex / useEsCandles, so it can only run in the browser. Every other
 * feed-consuming dashboard page in this repo therefore lives in
 * components/pages/ and is mounted ONLY by the Vite SPA (app-vite/src/App.tsx)
 * — there is no app/<name>/page.tsx for /flow, /em, /traders-dashboard, /ict,
 * /board, /replay and the rest, and that is deliberate.
 *
 * This file exists only so cbedge.net/premarket (the bare Next URL, without the
 * /app prefix) lands somewhere sensible instead of 404ing. It is a server
 * component with force-dynamic so Next never tries to prerender the client
 * tree: doing exactly that is what failed the Docker build on 2026-08-19
 * ("Export encountered an error on /premarket/page").
 *
 * The page itself: components/pages/Premarket.tsx
 * Served at:       /app/premarket (app/app/premarket/route.ts → serveSpaShell)
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function PremarketRedirect() {
  redirect("/app/premarket");
}
