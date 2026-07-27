var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/visitorAttribution.ts
var visitorAttribution_exports = {};
__export(visitorAttribution_exports, {
  SELF_HOSTS: () => SELF_HOSTS,
  buildAttribution: () => buildAttribution,
  classifyChannel: () => classifyChannel,
  parseReferrer: () => parseReferrer,
  parseUserAgent: () => parseUserAgent,
  parseUtm: () => parseUtm
});
module.exports = __toCommonJS(visitorAttribution_exports);
var MAX_REFERRER = 500;
var MAX_TAG = 120;
var MAX_HOST = 253;
function clip(v, max) {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s.length ? s : null;
}
var SELF_HOSTS = /* @__PURE__ */ new Set(["cbedge.net", "localhost", "127.0.0.1"]);
var SEARCH_HOSTS = [
  "google.",
  "bing.com",
  "duckduckgo.com",
  "search.yahoo.",
  "yahoo.com",
  "ecosia.org",
  "brave.com",
  "startpage.com",
  "baidu.com",
  "yandex.",
  "qwant.com",
  "searx",
  "perplexity.ai",
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com"
];
var SOCIAL_HOSTS = [
  "t.co",
  "twitter.com",
  "x.com",
  "reddit.com",
  "old.reddit.com",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linkedin.com",
  "lnkd.in",
  "youtube.com",
  "youtu.be",
  "discord.com",
  "discord.gg",
  "discordapp.com",
  "tiktok.com",
  "threads.net",
  "news.ycombinator.com",
  "stocktwits.com",
  "substack.com",
  "medium.com",
  "telegram.me",
  "t.me",
  "whatsapp.com"
];
var EMAIL_HOSTS = ["mail.google.com", "outlook.", "mail.yahoo.", "superhuman.com"];
function parseReferrer(raw, selfHosts = SELF_HOSTS) {
  const referrer = clip(raw, MAX_REFERRER);
  if (!referrer) return { referrer: null, referrerHost: null, isSelf: false };
  let host = null;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "").slice(0, MAX_HOST);
  } catch {
    const bare = referrer.toLowerCase().replace(/^www\./, "");
    host = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(bare) ? bare : null;
  }
  if (!host) return { referrer, referrerHost: null, isSelf: false };
  if (selfHosts.has(host)) return { referrer: null, referrerHost: null, isSelf: true };
  return { referrer, referrerHost: host, isSelf: false };
}
var CLICK_IDS = [
  // [query param, utm_source, utm_medium]
  ["gclid", "google", "cpc"],
  ["gbraid", "google", "cpc"],
  ["wbraid", "google", "cpc"],
  ["msclkid", "bing", "cpc"],
  ["fbclid", "facebook", "social"],
  ["igshid", "instagram", "social"],
  ["ttclid", "tiktok", "cpc"],
  ["twclid", "twitter", "social"],
  ["li_fat_id", "linkedin", "social"]
];
function parseUtm(rawQuery) {
  const empty = {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null
  };
  const q = clip(rawQuery, 2e3);
  if (!q) return empty;
  let params;
  try {
    const qs = q.includes("?") ? q.slice(q.indexOf("?") + 1) : q;
    params = new URLSearchParams(qs);
  } catch {
    return empty;
  }
  const get = (k) => clip(params.get(k), MAX_TAG);
  const out = {
    utmSource: get("utm_source")?.toLowerCase() ?? null,
    utmMedium: get("utm_medium")?.toLowerCase() ?? null,
    utmCampaign: get("utm_campaign"),
    utmTerm: get("utm_term"),
    utmContent: get("utm_content")
  };
  if (!out.utmSource) {
    for (const [param, source, medium] of CLICK_IDS) {
      if (params.has(param)) {
        out.utmSource = source;
        out.utmMedium = out.utmMedium ?? medium;
        break;
      }
    }
  }
  if (!out.utmSource) {
    const ref = get("ref");
    if (ref) {
      out.utmSource = ref.toLowerCase();
      out.utmMedium = out.utmMedium ?? "referral";
    }
  }
  return out;
}
function classifyChannel(ref, utm) {
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
var BOT_RE = /(bot|crawler|spider|crawling|slurp|mediapartners|facebookexternalhit|whatsapp|telegram|discordbot|slackbot|twitterbot|linkedinbot|embedly|quora link preview|pinterest|bitlybot|preview|headless|phantomjs|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl\/|wget\/|python-requests|python-urllib|axios\/|got \(|go-http-client|okhttp|java\/|libwww|scrapy|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|perplexitybot|applebot)/i;
var BROWSERS = [
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
  [/\bMSIE |\bTrident\//, "Internet Explorer"]
];
var OSES = [
  // iPadOS 13+ lies and claims "Macintosh", so iPad must be tested before macOS.
  [/\biPad\b|\biPhone\b|\biPod\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows NT\b|\bWindows Phone\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b|\bX11\b/, "Linux"]
];
function parseUserAgent(rawUa) {
  const ua = clip(rawUa, 400);
  if (!ua) return { browser: null, os: null, deviceType: null, isBot: false };
  if (BOT_RE.test(ua)) {
    return { browser: null, os: null, deviceType: "bot", isBot: true };
  }
  let browser = null;
  for (const [re, name] of BROWSERS) if (re.test(ua)) {
    browser = name;
    break;
  }
  let os = null;
  for (const [re, name] of OSES) if (re.test(ua)) {
    os = name;
    break;
  }
  const isTablet = /\biPad\b|\bTablet\b|\bPlayBook\b|\bSilk\b/.test(ua) || /\bAndroid\b/.test(ua) && !/\bMobile\b/.test(ua);
  const isMobile = !isTablet && /\bMobi\b|\bMobile\b|\biPhone\b|\biPod\b|\bWindows Phone\b/.test(ua);
  const deviceType = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";
  return { browser, os, deviceType, isBot: false };
}
function buildAttribution(input) {
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
    isBot: ua.isBot
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SELF_HOSTS,
  buildAttribution,
  classifyChannel,
  parseReferrer,
  parseUserAgent,
  parseUtm
});
