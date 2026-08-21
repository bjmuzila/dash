/**
 * The one place this app talks to the backend.
 *
 * Every call is same-origin and relative — nginx proxies /api to the dashboard
 * container (see nginx.conf), so there is no base URL to configure and no CORS
 * to get wrong. credentials:'include' on all of them because the aff_session
 * cookie is HttpOnly and same-site; without it every authed call reads as
 * signed-out.
 *
 * Errors are thrown as plain Error with the SERVER's message when there is one.
 * The backend already writes those for humans ("FLOWDESK is already taken."),
 * so re-wording them here would only make the two drift.
 */

export type Affiliate = {
  id: number;
  name: string;
  email: string;
  status: "pending" | "active" | "paused" | "declined";
  code: string | null;
  requested_code: string;
  prev_code: string | null;
  prev_code_until: string | null;
  // Named tier_pct on the server for column continuity, but there are no
  // tiers — it is this affiliate's commission rate, 20 unless overridden.
  tier_pct: number;
  cookie_days: number;
  channels: string[];
  primary_link: string | null;
  payout_method: "stripe" | "paypal" | "zelle";
  payout_detail: string | null;
  applied_at: string;
  approved_at: string | null;
  decline_reason: string | null;
};

export type Stats = {
  period: string;
  unpaid_cents: number;
  paid_cents: number;
  mtd_cents: number;
  members: number;
  clicks: number;
  clicks_30d: number;
  clicks_today: number;
  conversion_pct: number | null;
  series: { d: string; cents: number }[];
  recent: {
    id: number; kind: string; plan: string | null; customer_email: string | null;
    gross_cents: number; commission_cents: number; status: string; created_at: string;
  }[];
  payouts: {
    period: string; sales: number; gross_cents: number; refunds_cents: number;
    commission_cents: number; method: string | null; status: string;
    reference: string | null; paid_at: string | null;
  }[];
};

export type Creative = { id: string; label: string; image: string; text: string };

export type CodeRequest = {
  id: number; from_code: string | null; to_code: string; reason: string | null;
  status: string; created_at: string; decided_at: string | null; decided_note: string | null;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { cache: "no-store", credentials: "include", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string })?.error || `HTTP ${r.status}`);
  return j as T;
}

const post = <T,>(path: string, body: unknown) =>
  req<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const api = {
  me: () => req<{ affiliate: Affiliate }>("/api/aff/auth/me"),
  login: (email: string, password: string) =>
    post<{ affiliate: Affiliate }>("/api/aff/auth/login", { email, password }),
  logout: () => post<{ ok: true }>("/api/aff/auth/logout", {}),
  apply: (body: Record<string, unknown>) =>
    post<{ affiliate: Affiliate }>("/api/aff/auth/apply", body),
  codeCheck: (code: string) =>
    req<{ ok: boolean; code?: string; reason: string | null }>(
      `/api/aff/code-check?code=${encodeURIComponent(code)}`),
  stats: () =>
    req<{ pending: boolean; affiliate: Affiliate; link?: string; stats: Stats | null }>("/api/aff/stats"),
  creatives: () =>
    req<{ code?: string; link?: string; creatives: Creative[] }>("/api/aff/creatives"),
  codeRequests: () => req<{ requests: CodeRequest[] }>("/api/aff/code-requests"),
  requestCode: (code: string, reason: string) =>
    post<{ ok: true }>("/api/aff/code-request", { code, reason }),
  setPayout: (method: string, detail: string) =>
    post<{ ok: true }>("/api/aff/payout-method", { method, detail }),
};

// ── formatting ───────────────────────────────────────────────────────────────
export const money = (cents: number | null | undefined) =>
  (Number(cents || 0) / 100).toLocaleString("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });

export const money2 = (cents: number | null | undefined) =>
  (Number(cents || 0) / 100).toLocaleString("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  });

export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric",
  }) : "—";

export const PAYOUT_LABEL: Record<string, string> = {
  stripe: "Stripe", paypal: "PayPal", zelle: "Zelle",
};

/** Mask a referred customer's address. The affiliate is owed a number, not a
 *  mailing list — and the backend hands over the real address so the owner side
 *  can support them, so the masking has to happen before it is rendered. */
export const maskEmail = (e: string | null | undefined) => {
  if (!e) return "—";
  const [u, d] = e.split("@");
  if (!d) return "—";
  return `${u.slice(0, 1)}***@${d}`;
};
