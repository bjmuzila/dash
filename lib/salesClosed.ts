// ONE SWITCH for the whole CB Edge sales funnel.
//
// CB Edge is joining Voltick. Sales are closed: no new memberships, no
// renewals, no checkout. The platform itself is NOT closing, and every existing
// member keeps full access for the rest of the term they already paid for, so
// nothing here touches sign-in, the dashboard, the paid gate in middleware, or
// the Stripe billing portal. Read that again before you widen this flag: the
// announcement email (lib/emails/voltick-merger.ts) promises exactly that, and
// this file is the half of the promise the site has to keep.
//
// WHY A FLAG AND NOT A DELETE. Deleting the join buttons is a dozen edits to
// reverse under pressure, and the one that gets missed is always the server
// route, which is the one that can actually take somebody's money. This is a
// single boolean that every surface reads, so reopening sales is one line (or
// one env var on the VPS), and there is exactly one thing to check to know
// whether the door is shut.
//
// TO REOPEN: set NEXT_PUBLIC_SALES_OPEN=1 in the environment, or flip the
// default below. NEXT_PUBLIC_ is deliberate — the landing page, PublicNav and
// the pricing buttons are client components, and a bare SALES_OPEN would be
// undefined in the browser, leaving the buttons live while only the API said
// no. Next inlines NEXT_PUBLIC_ vars at BUILD time, so changing it on the VPS
// needs a rebuild, which `push.ps1` does anyway.
//
// THE SERVER CHECK IS THE REAL ONE. app/api/stripe/checkout/route.ts refuses
// before it ever talks to Stripe. Everything else in this file is so a visitor
// understands why, rather than clicking a button that fails.

/** Is the checkout closed? True unless someone deliberately reopens it. */
export const SALES_CLOSED = process.env.NEXT_PUBLIC_SALES_OPEN !== "1";

/** Short label for a control that has been switched off. */
export const SALES_CLOSED_LABEL = "Memberships are closed";

/** One line under a dead button. Says what happened and what still works. */
export const SALES_CLOSED_NOTE =
  "CB Edge is joining Voltick, so new memberships are closed. Existing members keep full access for the rest of their paid term.";

/** The longer version, for a page that has room (pricing, sign-up). */
export const SALES_CLOSED_BODY =
  "CB Edge is not shutting down. Only sales are. The platform stays up and every current member keeps everything they paid for, to the last day of their term. Yearly members keep all twelve months.";

/** Where a visitor who still wants a GEX platform should go instead. */
// voltick.io, not voltick.cbedge.net (2026-09-20). The subdomain on our own
// box sits behind a Cloudflare Access one-time-PIN policy on an email
// allowlist, so every public visitor sent there hit a login prompt for an
// account they do not have. This is the address the merger notice, the
// pricing page, the sign-up page and the announcement email all point at,
// so it is the ONE string to change if that ever moves again.
export const VOLTICK_URL = "https://voltick.io";
// ── MEMBERS ONLY ─────────────────────────────────────────────────────────────
// The discount code is for current CB Edge members (Brandon, 2026-09-20). It
// must not appear on any page a signed-out visitor or a non-member can reach —
// the landing page, /pricing's closed notice (shown to !access.ok), /sign-up.
// Its place is the member announcement email and anything behind the paid gate.
// A code on a public page is a public code, and every Voltick signup it pulls in
// at 75% off is one that would otherwise have paid full price.
export const VOLTICK_CODE = "TICK75";
export const VOLTICK_PITCH = `Voltick covers 1,000+ tickers. CB Edge members get 75% off with code ${VOLTICK_CODE}.`;

/** The same pitch with NO code — the only version a public page may render. */
export const VOLTICK_PUBLIC_PITCH = "Voltick covers 1,000+ tickers.";

/** What the checkout API says when it refuses. Plain enough to show a user. */
export const SALES_CLOSED_API_MESSAGE =
  "CB Edge is no longer taking new subscriptions. Existing memberships continue to the end of their paid term.";
