import type { MetadataRoute } from "next";
import { EXPLORE_SLUGS } from "@/components/explore/exploreContent";

// /sitemap.xml — the public site only. Added 2026-09-10: there was none, and
// the URL 307'd to the landing page (see the txt|xml note on middleware.ts's
// matcher). Everything gated stays out; a URL here is a promise that a
// signed-out crawler can fetch it and get a 200.
//
// Host comes from the same env the root layout's metadataBase uses, so the
// two can never disagree.
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://cbedge.net").replace(/\/+$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const url = (p: string) => `${SITE}${p}`;
  return [
    { url: url("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: url("/pricing"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: url("/explore/seasonality"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    ...EXPLORE_SLUGS.map((slug) => ({
      url: url(`/explore/${slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    { url: url("/docs"), lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: url("/whats-new"), lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: url("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: url("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: url("/risk-disclosure"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: url("/disclaimer"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
