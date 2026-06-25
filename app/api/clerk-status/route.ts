import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

// Owner-only, READ-ONLY Clerk panel for the owner dashboard.
//
// SECURITY: this route NEVER returns the secret key value. The publishable key
// (pk_*) is public by design — it ships to every browser — so a masked preview of
// it is safe. The secret key (sk_*) is reported only as a boolean "present" plus
// its environment (test/live) derived from the prefix; not one character of it is
// ever sent to the client. The secret IS used server-side here to call the Clerk
// Backend API (via the official @clerk/backend client) for read-only stats.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

// "pk_test_abcdEFGH....wxyz" → "pk_test_…wxyz" (prefix + last 4, middle redacted).
// Only ever applied to the PUBLISHABLE key.
function maskPublishable(key: string): string {
  if (!key) return "";
  const us = key.indexOf("_", key.indexOf("_") + 1); // end of "pk_test"/"pk_live"
  const prefix = us > 0 ? key.slice(0, us + 1) : key.slice(0, 8);
  const tail = key.slice(-4);
  return `${prefix}…${tail}`;
}

// pk_test_/sk_test_ → "test", pk_live_/sk_live_ → "live", else "unknown".
function envOf(key: string): "test" | "live" | "unknown" {
  if (/_live_/.test(key)) return "live";
  if (/_test_/.test(key)) return "test";
  return "unknown";
}

// Pull a total count off a paginated Clerk list response regardless of casing,
// or fall back to the array length.
function totalOf(res: unknown): number | null {
  if (res == null) return null;
  const r = res as { totalCount?: number; total_count?: number; data?: unknown[] };
  if (typeof r.totalCount === "number") return r.totalCount;
  if (typeof r.total_count === "number") return r.total_count;
  if (Array.isArray(r.data)) return r.data.length;
  if (Array.isArray(res)) return (res as unknown[]).length;
  return null;
}

// getUserList may return { data: User[] } (v5+) or a bare User[] (older). Normalize.
function userArray(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = res as { data?: unknown[] };
  return Array.isArray(r?.data) ? (r.data as Record<string, unknown>[]) : [];
}

// Best-effort primary email for a Clerk user object across shapes.
function primaryEmail(u: Record<string, unknown>): string | null {
  const addrs = (u.emailAddresses ?? u.email_addresses) as
    | Array<{ id?: string; emailAddress?: string; email_address?: string }>
    | undefined;
  if (!Array.isArray(addrs) || addrs.length === 0) return null;
  const primaryId = (u.primaryEmailAddressId ?? u.primary_email_address_id) as string | undefined;
  const primary = primaryId ? addrs.find((a) => a.id === primaryId) : undefined;
  const pick = primary ?? addrs[0];
  return pick?.emailAddress ?? pick?.email_address ?? null;
}

// Slimmed role-set shape for the owner panel.
interface RoleSetOut {
  id: string;
  name: string;
  key: string;
  type: string | null;
  defaultRoleKey: string | null;
  creatorRoleKey: string | null;
  roles: Array<{ id: string; name: string; key: string; membersCount: number | null }>;
}

// Read-only GET /role_sets via the Clerk Backend REST API. The secret is used
// only as the server-side Bearer credential and never leaves this function.
// Role Sets are an Organizations feature — instances without Orgs typically
// return an empty list (or 403), which we treat as "none configured".
async function fetchRoleSets(sk: string): Promise<{ data: RoleSetOut[]; error: string | null }> {
  try {
    const r = await fetch("https://api.clerk.com/v1/role_sets?limit=50&order_by=-created_at", {
      headers: { Authorization: `Bearer ${sk}` },
      cache: "no-store",
    });
    if (!r.ok) {
      // 403/404 here usually just means Organizations/Role Sets aren't enabled.
      return { data: [], error: `HTTP ${r.status}` };
    }
    const j = (await r.json()) as { data?: unknown[] };
    const arr = Array.isArray(j?.data) ? j.data : [];
    const data: RoleSetOut[] = arr.map((raw) => {
      const rs = raw as Record<string, unknown>;
      const roleItem = (it: unknown) => {
        const ri = it as Record<string, unknown>;
        return {
          id: String(ri.id ?? ""),
          name: String(ri.name ?? ri.key ?? ""),
          key: String(ri.key ?? ""),
          membersCount: typeof ri.members_count === "number" ? ri.members_count : null,
        };
      };
      const roles = Array.isArray(rs.roles) ? (rs.roles as unknown[]).map(roleItem) : [];
      const dflt = rs.default_role as Record<string, unknown> | undefined;
      const creator = rs.creator_role as Record<string, unknown> | undefined;
      return {
        id: String(rs.id ?? ""),
        name: String(rs.name ?? rs.key ?? ""),
        key: String(rs.key ?? ""),
        type: rs.type != null ? String(rs.type) : null,
        defaultRoleKey: dflt?.key != null ? String(dflt.key) : null,
        creatorRoleKey: creator?.key != null ? String(creator.key) : null,
        roles,
      };
    });
    return { data, error: null };
  } catch (err) {
    return { data: [], error: String((err as Error)?.message ?? err) };
  }
}

export async function GET() {
  // Gate: signed-in, and (if OWNER_USER_ID is set) only the owner.
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (OWNER_USER_ID && userId !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const pk = (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "").trim();
  const sk = (process.env.CLERK_SECRET_KEY || "").trim();

  // Environment is taken from whichever key is present (they should match).
  const environment = pk ? envOf(pk) : sk ? envOf(sk) : "unknown";
  const mismatch = !!pk && !!sk && envOf(pk) !== envOf(sk);

  // Read-only Backend-API stats. Wrapped so any Clerk failure (network, perms,
  // missing secret) degrades to nulls — the key-status card still renders.
  let userCount: number | null = null;
  let activeSessions: number | null = null;
  let recent: Array<{ id: string; email: string | null; name: string | null; createdAt: number | null }> = [];
  let statsError: string | null = null;

  // Role Sets (read-only). Fetched in parallel with the SDK stats below; both are
  // independently non-fatal so one failing doesn't blank the other.
  let roleSets: RoleSetOut[] = [];
  let roleSetsError: string | null = null;
  const roleSetsPromise = sk ? fetchRoleSets(sk) : Promise.resolve({ data: [], error: null });

  if (sk) {
    try {
      const client = await clerkClient();

      const [countRes, listRes, sessRes] = await Promise.allSettled([
        client.users.getCount(),
        client.users.getUserList({ orderBy: "-created_at", limit: 10 }),
        client.sessions.getSessionList({ status: "active", limit: 1 }),
      ]);

      if (countRes.status === "fulfilled") {
        userCount = typeof countRes.value === "number" ? countRes.value : totalOf(countRes.value);
      }

      if (listRes.status === "fulfilled") {
        recent = userArray(listRes.value).map((u) => {
          const first = (u.firstName ?? u.first_name) as string | undefined;
          const last = (u.lastName ?? u.last_name) as string | undefined;
          const name = [first, last].filter(Boolean).join(" ").trim() || null;
          const createdRaw = (u.createdAt ?? u.created_at) as number | string | undefined;
          const createdAt =
            typeof createdRaw === "number" ? createdRaw
            : typeof createdRaw === "string" ? Date.parse(createdRaw) || null
            : null;
          return { id: String(u.id ?? ""), email: primaryEmail(u), name, createdAt };
        });
        // If getCount wasn't available, fall back to the list's total.
        if (userCount == null) userCount = totalOf(listRes.value);
      }

      if (sessRes.status === "fulfilled") {
        activeSessions = totalOf(sessRes.value);
      }

      // Surface a short error only if everything failed.
      if (countRes.status === "rejected" && listRes.status === "rejected" && sessRes.status === "rejected") {
        statsError = String((countRes.reason as Error)?.message ?? countRes.reason ?? "Clerk API error");
      }
    } catch (err) {
      statsError = String((err as Error)?.message ?? err);
    }
  }

  // Await the role-sets fetch kicked off above.
  {
    const rs = await roleSetsPromise;
    roleSets = rs.data;
    roleSetsError = rs.error;
  }

  return NextResponse.json({
    ok: true,
    configured: !!pk && !!sk,
    environment,            // "test" | "live" | "unknown"
    mismatch,               // pk/sk environments disagree (misconfig)
    publishable: {
      present: !!pk,
      masked: maskPublishable(pk), // safe: publishable key is public anyway
    },
    secret: {
      present: !!sk,        // boolean ONLY — the value is never returned
    },
    // Read-only Backend-API stats (null when unavailable).
    stats: {
      userCount,
      activeSessions,
      recent,               // up to 10 newest users: {id,email,name,createdAt}
      error: statsError,
    },
    // Read-only role sets (empty when Organizations/Role Sets aren't enabled).
    roleSets,
    roleSetsError,
    ts: Date.now(),
  });
}
