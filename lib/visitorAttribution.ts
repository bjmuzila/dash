/**
 * Visitor attribution parsing — referrer, UTM tags, and user agent.
 *
 * This is the SOURCE OF TRUTH. `server-v2/_lib-attribution.cjs` is a generated
 * esbuild mirror of this file (same pattern as lib/db.ts → _lib-db.cjs), because
 * the live backend (server-v2/api-router.js) is plain CJS and cannot import TS.
 * If you edit this file, regenerate the mirror:
 *
 *   npx esbuild lib/visitorAttribution.ts --bundle --platform=node \
 *     --format=cjs --outfile=server-v2/_lib-attribution.cjs
 *
 * Everything here is pure and dependency-free so the mirror stays tiny and both
 * copies can be unit-tested with the same fixtures (tests/visitorAttribution.test.ts).
 *
 * WHY THE CLIENT SENDS THE REFERRER INSTEAD OF US READING THE HEADER:
 * /api/page-status is a beacon fired BY the page, so the request's own `Referer`
 * header is the page itself — useless for acquisition. The only source of the
 * true inbound referrer is `document.referrer` in the browser, which lib/pageStatus.ts
 * puts in the POST body. Never "fix" this by reading req.headers.referer.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Traffic channel, derived from referrer + UTM. Cheap grouping for the owner UI. */
export type Channel = "direct" | "search" | "social" | "paid" | "email" | "referral" | "internal";

export interface ReferrerInfo {
  /** Full inbound URL, capped. Null for direct traffic and self-referrals. */
  referrer: string | null;
  /** Bare hostname, www-stripped and lowercased — the thing you GROUP BY. */
  referrerHost: string | null;
  /** True when the referrer was one of our own hosts (an internal navigation). */
  isSelf: boolean;
}

export interface UtmInfo {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
}

export interface UserAgentInfo {
  browser: string | null;
  os: string | null;
  /** "mobile" | "tablet" | "desktop" | "bot" */
  deviceType: string | null;
  isBot: boolean;
}

// ── Limits ───────────────────────────────────────────────────────────────────

// Referrer URLs can be arbitrarily long and are attacker-controlled (anyone can
// send us any string). Cap hard so a hostile beacon can't bloat the table.
const MAX_REFERRER = 500;
const MAX_TAG = 120;
const MAX_HOST = 253; // max legal DNS name length

function clip(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s.length ? s : null;
}

// ── Referrer ─────────────────────────────────────────────────────────────────

/**
 * Hosts that count as "us". A referrer matching one of these is an internal
 * navigation, not an acquisition event, so it is stored as NULL rather than
 * polluting the top-referrers list with our own domain.
 *
 * Compared on the www-stripped hostname, so "cbedge.net" covers "www.cbedge.net".
 */
export const SELF_HOSTS = new Set(["cbedge.net", "localhost", "127.0.0.1"]);

const SEARCH_HOSTS = [
  "google.", "bing.com", "duckduckgo.com", "search.yahoo.", "yahoo.com",
  "ecosia.org", "brave.com", "startpage.com", "baidu.com", "yandex.",
  "qwant.com", "searx", "perplexity.ai", "chatgpt.com", "chat.openai.com",
  "claude.ai", "gemini.google.com", "copilot.microsoft.com",
];

const SOCIAL_HOSTS = [
  "t.co", "twitter.com", "x.com", "reddit.com", "old.reddit.com",
  "facebook.com", "fb.com", "instagram.com", "linkedin.com", "lnkd.in",
  "youtube.com", "youtu.be", "discord.com", "discord.gg", "discordapp.com",
  "tiktok.com", "threads.net", "news.ycombinator.com", "stocktwits.com",
  "substack.com", "medium.com", "telegram.me", "t.me", "whatsapp.com",
];

const EMAIL_HOSTS = ["mail.google.com", "outlook.", "mail.yahoo.", "superhuman.com"];

/**
 * Parse `document.referrer` into a storable pair.
 *
 * Returns nulls (not an error) for anything unparseable — an inbound visit must
 * never be dropped because a browser sent a weird referrer string.
 */
export function parseReferrer(raw: unknown, selfHosts: Set<string> = SELF_HOSTS): ReferrerInfo {
  const referrer = clip(raw, MAX_REFERRER);
  if (!referrer) return { referrer: null, referrerHost: null, isSelf: false };

  let host: string | null = null;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "").slice(0, MAX_HOST);
  } catch {
    // Not a URL. Some browsers/apps send a bare host; accept that shape, else drop.
    const bare = referrer.toLowerCase().replace(/^www\./, "");
    host = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(bare) ? bare : null;
  }
  if (!host) return { referrer, referrerHost: null, isSelf: false };

  // Self-referral: an internal click, not an acquisition. Report it as such and
  // store nothing, so "top referrers" stays a list of OTHER people's sites.
  if (selfHosts.has(host)) return { referrer: null, referrerHost: null, isSelf: true };

  return { referrer, referrerHost: host, isSelf: false };
}

// ── UTM / click IDs ──────────────────────────────────────────────────────────

/**
 * Ad platforms append a click ID instead of UTM tags when you forget to tag the
 * link — which is most of the time. Treat a bare click ID as paid traffic from
 * that network so those visits don't silently land in "direct".
 */
const CLICK_IDS: [string, string, string][] = [
  // [query param, utm_source, utm_medium]
  ["gclid", "google", "cpc"],
  ["gbraid", "google", "cpc"],
  ["wbraid", "google", "cpc"],
  ["msclkid", "bing", "cpc"],
  ["fbclid", "facebook", "social"],
  ["igshid", "instagram", "social"],
  ["ttclid", "tiktok", "cpc"],
  ["twclid", "twitter", "social"],
  ["li_fat_id", "linkedin", "social"],
];

/**
 * Pull UTM tags out of a landing-page query string.
 *
 * Accepts "?a=b" or "a=b" or a full URL. source/medium are lowercased because
 * they are grouping keys and "Google" vs "google" splitting a report is the most
 * common self-inflicted analytics wound. campaign/term/content keep their case —
 * they're labels a human reads, not keys.
 */
export function parseUtm(rawQuery: unknown): UtmInfo {
  const empty: UtmInfo = {
    utmSource: null, utmMedium: null, utmCampaign: null, utmTerm: null, utmContent: null,
  };
  const q = clip(rawQuery, 2000);
  if (!q) return empty;

  let params: URLSearchParams;
  try {
    const qs = q.includes("?") ? q.slice(q.indexOf("?") + 1) : q;
    params = new URLSearchParams(qs);
  } catch {
    return empty;
  }

  const get = (k: string) => clip(params.get(k), MAX_TAG);
  const out: UtmInfo = {
    utmSource: get("utm_source")?.toLowerCase() ?? null,
    utmMedium: get("utm_medium")?.toLowerCase() ?? null,
    utmCampaign: get("utm_campaign"),
    utmTerm: get("utm_term"),
    utmContent: get("utm_content"),
  };

  // Untagged ad traffic: infer source/medium from the click ID, but never
  // overwrite an explicit utm_source the marketer actually set.
  if (!out.utmSource) {
    for (const [param, source, medium] of CLICK_IDS) {
      if (params.has(param)) {
        out.utmSource = source;
        out.utmMedium = out.utmMedium ?? medium;
        break;
      }
    }
  }

  // Bare "?ref=" is the convention on directories, newsletters and IndieHackers-
  // style link lists. Treat it as a referral source when nothing better exists.
  if (!out.utmSource) {
    const ref = get("ref");
    if (ref) {
      out.utmSource = ref.toLowerCase();
      out.utmMedium = out.utmMedium ?? "referral";
    }
  }

  return out;
}

// ── Channel ──────────────────────────────────────────────────────────────────

/** Bucket a visit into one channel. UTM medium wins over referrer host. */
export function classifyChannel(ref: ReferrerInfo, utm: UtmInfo): Channel {
  const medium = utm.utmMedium ?? "";
  if (/^(cpc|ppc|paid|paidsearch|paid_search|display|banner|retargeting)$/.test(medium)) return "paid";
  if (/^(email|newsletter)$/.test(medium)) return "email";
  if (/^(social|social_paid|social-network)$/.test(medium)) return "social";

  const host = ref.referrerHost;
  if (ref.isSelf) return "internal";
  if (!host) return utm.utmSource ? "referral" : "direct";
  if (SEARCH_HOSTS.some((h) => host.includes(h))) return "search";
  if (SOCIAL_HOSTS.some((h) => host === h || host.endsWith("." + h))) return "social";
  if (EMAIL_HOSTS.some((h) => host.includes(h))) return "email";
  return "referral";
}

// ── User agent ───────────────────────────────────────────────────────────────

// Deliberately broad. A false "bot" costs one mislabelled row; a bot counted as
// a human quietly inflates every number on the owner dashboard.
const BOT_RE = /(bot|crawler|spider|crawling|slurp|mediapartners|facebookexternalhit|whatsapp|telegram|discordbot|slackbot|twitterbot|linkedinbot|embedly|quora link preview|pinterest|bitlybot|preview|headless|phantomjs|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl\/|wget\/|python-requests|python-urllib|axios\/|got \(|go-http-client|okhttp|java\/|libwww|scrapy|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|perplexitybot|applebot)/i;

const BROWSERS: [RegExp, string][] = [
  // Order matters: every Chromium browser also says "Chrome", and every
  // WebKit browser also says "Safari". Most specific first, always.
  [/\bEdgA?\/|\bEdge\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bVivaldi\//, "Vivaldi"],
  [/\bBrave\//, "Brave"],
  [/\bYaBrowser\//, "Yandex"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bSafari\//, "Safari"],
  [/\bMSIE |\bTrident\//, "Internet Explorer"],
];

const OSES: [RegExp, string][] = [
  // iPadOS 13+ lies and claims "Macintosh", so iPad must be tested before macOS.
  [/\biPad\b|\biPhone\b|\biPod\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows NT\b|\bWindows Phone\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b|\bX11\b/, "Linux"],
];

/**
 * Classify a raw User-Agent string.
 *
 * Intentionally coarse: browser family, OS family, form factor. No versions —
 * they change weekly, they'd shatter every GROUP BY, and nothing on the owner
 * dashboard asks "how many people are on Chrome 141 specifically".
 */
export function parseUserAgent(rawUa: unknown): UserAgentInfo {
  const ua = clip(rawUa, 400);
  if (!ua) return { browser: null, os: null, deviceType: null, isBot: false };

  if (BOT_RE.test(ua)) {
    return { browser: null, os: null, deviceType: "bot", isBot: true };
  }

  let browser: string | null = null;
  for (const [re, name] of BROWSERS) if (re.test(ua)) { browser = name; break; }

  let os: string | null = null;
  for (const [re, name] of OSES) if (re.test(ua)) { os = name; break; }

  // Tablets first: an Android tablet's UA is an Android UA WITHOUT "Mobile",
  // which is the only signal Google gives us.
  const isTablet = /\biPad\b|\bTablet\b|\bPlayBook\b|\bSilk\b/.test(ua)
    || (/\bAndroid\b/.test(ua) && !/\bMobile\b/.test(ua));
  const isMobile = !isTablet && (/\bMobi\b|\bMobile\b|\biPhone\b|\biPod\b|\bWindows Phone\b/.test(ua));
  const deviceType = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  return { browser, os, deviceType, isBot: false };
}

// ── One-call helper ──────────────────────────────────────────────────────────

export interface VisitAttribution
  extends UtmInfo, Omit<ReferrerInfo, "isSelf">, Omit<UserAgentInfo, "isBot"> {
  channel: Channel;
  isBot: boolean;
}

/**
 * Everything the write path needs, in one call.
 *
 * `referrer` / `query` come from the CLIENT (document.referrer and
 * window.location.search); `userAgent` comes from the request header. Passing the
 * request's own Referer header here would attribute every visit to ourselves.
 */
export function buildAttribution(input: {
  referrer?: unknown;
  query?: unknown;
  userAgent?: unknown;
  selfHosts?: Set<string>;
}): VisitAttribution {
  const ref = parseReferrer(input.referrer, input.selfHosts ?? SELF_HOSTS);
  const utm = parseUtm(input.query);
  const ua = parseUserAgent(input.userAgent);
  return {
    referrer: ref.referrer,
    referrerHost: ref.referrerHost,
    ...utm,
    channel: classifyChannel(ref, utm),
    browser: ua.browser,
    os: ua.os,
    deviceType: ua.deviceType,
    isBot: ua.isBot,
  };
}
