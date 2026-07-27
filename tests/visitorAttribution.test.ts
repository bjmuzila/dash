import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseReferrer,
  parseUtm,
  parseUserAgent,
  classifyChannel,
  buildAttribution,
  SELF_HOSTS,
} from "../lib/visitorAttribution";

// ── Referrer ─────────────────────────────────────────────────────────────────

test("referrer: strips www and lowercases the host", () => {
  const r = parseReferrer("https://WWW.Reddit.com/r/options/comments/abc");
  assert.equal(r.referrerHost, "reddit.com");
  assert.equal(r.isSelf, false);
  assert.equal(r.referrer, "https://WWW.Reddit.com/r/options/comments/abc");
});

test("referrer: our own domain is a self-referral, stored as null", () => {
  const r = parseReferrer("https://cbedge.net/pricing");
  assert.equal(r.isSelf, true);
  assert.equal(r.referrer, null);
  assert.equal(r.referrerHost, null);
});

test("referrer: www.cbedge.net is also us", () => {
  assert.equal(parseReferrer("https://www.cbedge.net/").isSelf, true);
});

test("referrer: extra self hosts can be injected per-request", () => {
  const hosts = new Set([...SELF_HOSTS, "staging.cbedge.net"]);
  assert.equal(parseReferrer("https://staging.cbedge.net/x", hosts).isSelf, true);
  // …without leaking into the shared default set.
  assert.equal(parseReferrer("https://staging.cbedge.net/x").isSelf, false);
});

test("referrer: empty / missing means direct traffic, not an error", () => {
  for (const v of ["", "   ", null, undefined, 42, {}]) {
    const r = parseReferrer(v as unknown);
    assert.equal(r.referrerHost, null, `input ${JSON.stringify(v)}`);
    assert.equal(r.isSelf, false);
  }
});

test("referrer: accepts a bare hostname (some apps send one)", () => {
  assert.equal(parseReferrer("news.ycombinator.com").referrerHost, "news.ycombinator.com");
});

test("referrer: unparseable junk keeps the raw value but no host", () => {
  const r = parseReferrer("not a url at all");
  assert.equal(r.referrerHost, null);
  assert.equal(r.referrer, "not a url at all");
});

test("referrer: hostile length is capped", () => {
  const r = parseReferrer("https://evil.com/" + "a".repeat(5000));
  assert.ok(r.referrer!.length <= 500);
  assert.equal(r.referrerHost, "evil.com");
});

// ── UTM ──────────────────────────────────────────────────────────────────────

test("utm: source/medium lowercased, campaign keeps its case", () => {
  const u = parseUtm("?utm_source=Twitter&utm_medium=Social&utm_campaign=Summer_Launch");
  assert.equal(u.utmSource, "twitter");
  assert.equal(u.utmMedium, "social");
  assert.equal(u.utmCampaign, "Summer_Launch");
});

test("utm: accepts a full URL or a bare query string", () => {
  assert.equal(parseUtm("https://cbedge.net/?utm_source=x").utmSource, "x");
  assert.equal(parseUtm("utm_source=y").utmSource, "y");
});

test("utm: gclid alone is treated as paid Google traffic", () => {
  const u = parseUtm("?gclid=EAIaIQobChMI");
  assert.equal(u.utmSource, "google");
  assert.equal(u.utmMedium, "cpc");
});

test("utm: fbclid is social Facebook traffic", () => {
  const u = parseUtm("?fbclid=IwAR123");
  assert.equal(u.utmSource, "facebook");
  assert.equal(u.utmMedium, "social");
});

test("utm: an explicit utm_source always beats a click ID", () => {
  const u = parseUtm("?utm_source=newsletter&utm_medium=email&gclid=abc");
  assert.equal(u.utmSource, "newsletter");
  assert.equal(u.utmMedium, "email");
});

test("utm: bare ?ref= becomes a referral source", () => {
  const u = parseUtm("?ref=producthunt");
  assert.equal(u.utmSource, "producthunt");
  assert.equal(u.utmMedium, "referral");
});

test("utm: no query means all nulls", () => {
  const u = parseUtm("");
  assert.deepEqual(u, {
    utmSource: null, utmMedium: null, utmCampaign: null, utmTerm: null, utmContent: null,
  });
});

// ── Channel ──────────────────────────────────────────────────────────────────

const noRef = { referrer: null, referrerHost: null, isSelf: false };
const noUtm = { utmSource: null, utmMedium: null, utmCampaign: null, utmTerm: null, utmContent: null };

test("channel: nothing at all is direct", () => {
  assert.equal(classifyChannel(noRef, noUtm), "direct");
});

test("channel: search engines and AI assistants are search", () => {
  for (const host of ["google.com", "google.co.uk", "bing.com", "duckduckgo.com", "chatgpt.com", "perplexity.ai"]) {
    assert.equal(classifyChannel({ ...noRef, referrerHost: host }, noUtm), "search", host);
  }
});

test("channel: socials are social, including subdomains", () => {
  for (const host of ["t.co", "reddit.com", "old.reddit.com", "discord.com", "news.ycombinator.com", "m.youtube.com"]) {
    assert.equal(classifyChannel({ ...noRef, referrerHost: host }, noUtm), "social", host);
  }
});

test("channel: an unknown site is a referral", () => {
  assert.equal(classifyChannel({ ...noRef, referrerHost: "someblog.dev" }, noUtm), "referral");
});

test("channel: utm_medium=cpc wins over the referrer host", () => {
  const ref = { ...noRef, referrerHost: "google.com" };
  assert.equal(classifyChannel(ref, { ...noUtm, utmMedium: "cpc" }), "paid");
});

test("channel: a self-referral is internal", () => {
  assert.equal(classifyChannel({ referrer: null, referrerHost: null, isSelf: true }, noUtm), "internal");
});

// ── User agent ───────────────────────────────────────────────────────────────

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  androidPhone: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  discordbot: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  curl: "curl/8.5.0",
};

test("ua: Edge is not reported as Chrome", () => {
  assert.equal(parseUserAgent(UA.edgeWin).browser, "Edge");
  assert.equal(parseUserAgent(UA.chromeWin).browser, "Chrome");
});

test("ua: Chrome is not reported as Safari", () => {
  assert.equal(parseUserAgent(UA.chromeWin).browser, "Chrome");
  assert.equal(parseUserAgent(UA.safariMac).browser, "Safari");
});

test("ua: OS families", () => {
  assert.equal(parseUserAgent(UA.chromeWin).os, "Windows");
  assert.equal(parseUserAgent(UA.safariMac).os, "macOS");
  assert.equal(parseUserAgent(UA.iphone).os, "iOS");
  assert.equal(parseUserAgent(UA.ipad).os, "iOS");
  assert.equal(parseUserAgent(UA.androidPhone).os, "Android");
  assert.equal(parseUserAgent(UA.firefox).os, "Linux");
});

test("ua: form factor — the Android tablet trap", () => {
  assert.equal(parseUserAgent(UA.chromeWin).deviceType, "desktop");
  assert.equal(parseUserAgent(UA.iphone).deviceType, "mobile");
  assert.equal(parseUserAgent(UA.ipad).deviceType, "tablet");
  assert.equal(parseUserAgent(UA.androidPhone).deviceType, "mobile");
  // Android + no "Mobile" token = tablet. This is the only signal Google gives.
  assert.equal(parseUserAgent(UA.androidTablet).deviceType, "tablet");
});

test("ua: bots are flagged and not counted as browsers", () => {
  for (const ua of [UA.googlebot, UA.discordbot, UA.curl]) {
    const p = parseUserAgent(ua);
    assert.equal(p.isBot, true, ua);
    assert.equal(p.deviceType, "bot");
    assert.equal(p.browser, null);
  }
});

test("ua: real browsers are never flagged as bots", () => {
  for (const [name, ua] of Object.entries(UA)) {
    if (name === "googlebot" || name === "discordbot" || name === "curl") continue;
    assert.equal(parseUserAgent(ua).isBot, false, name);
  }
});

test("ua: missing header is all nulls, not a crash", () => {
  assert.deepEqual(parseUserAgent(null), { browser: null, os: null, deviceType: null, isBot: false });
});

// ── End to end ───────────────────────────────────────────────────────────────

test("e2e: paid Google click on a phone", () => {
  const a = buildAttribution({
    referrer: "https://www.google.com/",
    query: "?gclid=abc123",
    userAgent: UA.androidPhone,
  });
  assert.equal(a.referrerHost, "google.com");
  assert.equal(a.utmSource, "google");
  assert.equal(a.channel, "paid"); // medium=cpc outranks the search host
  assert.equal(a.deviceType, "mobile");
  assert.equal(a.isBot, false);
});

test("e2e: organic Reddit visit on desktop", () => {
  const a = buildAttribution({
    referrer: "https://old.reddit.com/r/thetagang/",
    query: "",
    userAgent: UA.chromeWin,
  });
  assert.equal(a.channel, "social");
  assert.equal(a.referrerHost, "old.reddit.com");
  assert.equal(a.utmSource, null);
  assert.equal(a.browser, "Chrome");
});

test("e2e: an internal navigation reports internal, with no referrer stored", () => {
  const a = buildAttribution({ referrer: "https://cbedge.net/pricing", userAgent: UA.chromeWin });
  assert.equal(a.channel, "internal");
  assert.equal(a.referrer, null);
  assert.equal(a.referrerHost, null);
});

test("e2e: direct visit", () => {
  const a = buildAttribution({ referrer: "", query: "", userAgent: UA.safariMac });
  assert.equal(a.channel, "direct");
  assert.equal(a.referrerHost, null);
  assert.equal(a.os, "macOS");
});

test("e2e: nothing at all still returns a complete row", () => {
  const a = buildAttribution({});
  assert.equal(a.channel, "direct");
  assert.equal(a.isBot, false);
  for (const k of ["referrer", "referrerHost", "utmSource", "browser", "os", "deviceType"] as const) {
    assert.equal(a[k], null, k);
  }
});
