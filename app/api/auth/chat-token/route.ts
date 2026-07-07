import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getServerSession } from "@/lib/supabase/server";

/**
 * Mints a short-lived Supabase-compatible JWT for the signed-in user, so the
 * browser can authenticate the /chat Realtime channel + RLS-protected
 * chat_messages table (`user_id = auth.uid()` policies) WITHOUT the app
 * running full Supabase Auth anymore. Supabase Realtime/PostgREST only need a
 * JWT signed with the project's SUPABASE_JWT_SECRET (HS256, role=authenticated)
 * -- it doesn't have to come from GoTrue. The secret never reaches the browser;
 * only the resulting token does, and only for the caller's own user id.
 *
 * See lib/supabase/client.ts, which fetches this to feed supabase-js's
 * `accessToken` callback.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUPABASE_JWT_SECRET = (process.env.SUPABASE_JWT_SECRET || "").trim();
const SUPABASE_JWT_KID = (process.env.SUPABASE_JWT_KID || "").trim();
const TTL_SEC = 3600;

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signSupabaseJwt(userId: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header: Record<string, string> = { alg: "HS256", typ: "JWT" };
  if (SUPABASE_JWT_KID) header.kid = SUPABASE_JWT_KID;
  const payload = {
    sub: userId,
    email,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + TTL_SEC,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", SUPABASE_JWT_SECRET).update(signingInput).digest();
  return `${signingInput}.${b64url(signature)}`;
}

export async function GET() {
  if (!SUPABASE_JWT_SECRET) {
    return NextResponse.json({ error: "Chat is not configured (SUPABASE_JWT_SECRET missing)" }, { status: 500 });
  }
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = signSupabaseJwt(session.userId, session.email);
  return NextResponse.json({ token, expiresAt: Date.now() + TTL_SEC * 1000 });
}
