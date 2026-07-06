import { cookies } from "next/headers";
import { SESSION_COOKIE, validateSessionToken, type ResolvedSession } from "@/lib/auth/session";

/**
 * Server-side session accessors for the custom auth system.
 *
 * NOTE: this file kept its `lib/supabase/*` path and original export names
 * (getServerUserId, getServerIsOwner) on purpose -- ~40 existing API routes /
 * server components import from here, and none of them needed to change when
 * Supabase Auth was replaced with our own users/sessions tables. Only the
 * internals changed. New code can import getServerSession()/getServerUser()
 * directly; there's nothing Supabase-specific left in this file.
 */

export async function getServerSession(): Promise<ResolvedSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return validateSessionToken(token);
}

/** Mirrors the old `const { userId } = await auth()` (Clerk) / Supabase shape. */
export async function getServerUserId(): Promise<string | null> {
  const session = await getServerSession();
  return session?.userId ?? null;
}

/** { id, email } for routes that need the email too (Stripe customer email,
 *  feedback attribution, etc.) without a second query. */
export async function getServerUser(): Promise<{ id: string; email: string } | null> {
  const session = await getServerSession();
  return session ? { id: session.userId, email: session.email } : null;
}

export async function getServerIsOwner(): Promise<boolean> {
  const session = await getServerSession();
  return !!session?.isOwner;
}

export async function getServerIsPaid(): Promise<boolean> {
  const session = await getServerSession();
  return !!session?.isPaid;
}
