/**
 * The page-visit beacon: one POST per page opened in this app, for the owner's
 * Voltick Usage page (owner.cbedge.net/owner/voltick-usage).
 *
 *   POST /api/voltick/visit { path, label }   server-v2/voltick-visits.cjs
 *
 * Who it was comes from the session cookie on the server, never from here. The
 * path is sent without its query string or hash (the server strips them too).
 * Fire and forget: a failed beacon must never touch the page, so every error is
 * swallowed, and `keepalive` lets the last one finish when a tab closes.
 */
export function recordVisit(path: string, label: string | null): void {
  try {
    void fetch("/api/voltick/visit", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: path.split(/[?#]/)[0], label }),
    }).catch(() => {});
  } catch {
    /* no fetch, or blocked: the page carries on */
  }
}
