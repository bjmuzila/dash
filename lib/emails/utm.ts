/**
 * Campaign tagging for outbound email.
 *
 * Every link we send in an email is a link someone might click and arrive on,
 * and an untagged arrival is indistinguishable from typing the URL: it lands in
 * "Direct" on the owner Acquisition panel, or under `mail.google.com` if the
 * client happens to leak a referrer. Neither tells you the newsletter worked.
 *
 * So the send paths rewrite `<a href>` on the way out. Both of them —
 * `/api/admin/send-email` (owner broadcast) and `lib/emails/send.ts`
 * (transactional) — call in here, so tagging is not something anyone has to
 * remember per send.
 *
 * FIVE THINGS THIS DELIBERATELY WILL NOT TOUCH, each one a way to break a live
 * email:
 *
 *  1. Anything containing `{{` — `{{UNSUBSCRIBE_URL}}` and `{{PROMO_CODE}}` are
 *     swapped per recipient AFTER this runs. Re-encoding a URL that carries a
 *     placeholder (a real URL parser percent-encodes the braces) would leave a
 *     dead `%7BPROMO_CODE%7D` in a delivered email.
 *  2. Unsubscribe links, by path, belt-and-braces with (1) — a tagged
 *     unsubscribe URL is a broken HMAC and a CAN-SPAM problem.
 *  3. Anything already carrying `utm_source`. A hand-tagged link in a template
 *     wins; we never stack two campaigns on one URL.
 *  4. Any host that isn't ours. Tagging someone else's site is noise at best.
 *  5. `src=` attributes. Only `<a href>` is rewritten, so the logo image and any
 *     tracking pixel are left exactly as the template wrote them.
 *
 * And it does the rewrite by STRING SURGERY, not by `new URL().toString()`.
 * Round-tripping through the URL parser normalises things — case, default
 * ports, percent-encoding — and every one of those changes is a chance to break
 * a signed link. Appending a query string cannot.
 */

/** Our own hosts. Anything else is left alone. */
function selfHosts(): Set<string> {
  const hosts = new Set(["cbedge.net", "localhost", "127.0.0.1"]);
  const env = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (env) {
    const m = /^https?:\/\/([^/?#:]+)/i.exec(env);
    if (m) hosts.add(m[1].toLowerCase().replace(/^www\./, ""));
  }
  return hosts;
}

export interface EmailUtm {
  /** Where it was sent from: "email" for broadcasts, "newsletter" for the letter. */
  source: string;
  /** Always "email" for this module — it is what buckets the arrival on the panel. */
  medium: string;
  /** Which send it was. One string per send, reused nowhere else. */
  campaign: string;
}

/**
 * Normalise anything (a subject line, a template name) into a campaign tag.
 * Lowercase, hyphenated, ASCII — because these become table rows the owner
 * reads side by side, and "Weekly Edge — Aug 21" vs "weekly edge aug 21" would
 * be two rows for one send.
 */
export function campaignSlug(input: string, fallback = "broadcast"): string {
  const s = (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || fallback;
}

// Absolute http(s) URL, split into scheme / host / path / query / fragment.
const ABS_URL = /^(https?:\/\/)([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i;

// Unsubscribe, both the human page and the RFC 8058 one-click endpoint.
const UNSUBSCRIBE_PATH = /^\/(api\/)?unsubscribe(\/|$)/i;

const enc = encodeURIComponent;

/** Tag one URL, or return it byte-for-byte unchanged. Never throws. */
export function tagUrl(raw: string, utm: EmailUtm, hosts = selfHosts()): string {
  if (!raw || raw.includes("{{")) return raw;

  const m = ABS_URL.exec(raw.trim());
  if (!m) return raw; // relative, mailto:, tel:, #anchor, or not a URL at all

  const [, scheme, hostPort, pathRaw, queryRaw, hash] = m;
  const host = hostPort.toLowerCase().split(":")[0].replace(/^www\./, "");
  if (!hosts.has(host)) return raw;

  const path = pathRaw || "/";
  if (UNSUBSCRIBE_PATH.test(path)) return raw;

  const query = queryRaw || "";
  if (/[?&]utm_source=/i.test(query)) return raw;

  const add = `utm_source=${enc(utm.source)}&utm_medium=${enc(utm.medium)}&utm_campaign=${enc(utm.campaign)}`;
  const sep = query ? "&" : "?";
  return `${scheme}${hostPort}${path}${query}${sep}${add}${hash || ""}`;
}

/**
 * Tag every `<a href>` in an HTML email body. Attribute values may be quoted
 * with either quote character; `src=` is not matched, so images are untouched.
 */
export function tagEmailLinksHtml(html: string, utm: EmailUtm): string {
  if (!html) return html;
  const hosts = selfHosts();
  return html.replace(
    /(<a\b[^>]*?\bhref\s*=\s*)(["'])([\s\S]*?)\2/gi,
    (_full, pre: string, quote: string, url: string) => `${pre}${quote}${tagUrl(url, utm, hosts)}${quote}`
  );
}

/** Text-body equivalent: tag bare URLs, leaving trailing punctuation alone. */
export function tagEmailLinksText(text: string, utm: EmailUtm): string {
  if (!text) return text;
  const hosts = selfHosts();
  return text.replace(/https?:\/\/[^\s<>"')\]]+/gi, (url) => {
    // A URL at the end of a sentence swallows the period; strip trailing
    // punctuation, tag, then put it back.
    const trail = /[.,;:!?]+$/.exec(url)?.[0] ?? "";
    const bare = trail ? url.slice(0, -trail.length) : url;
    return tagUrl(bare, utm, hosts) + trail;
  });
}
