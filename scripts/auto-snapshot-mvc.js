#!/usr/bin/env node
/**
 * Auto-collect an MVC snapshot into the DB, mirroring the SnapButton flow:
 *   GET  /api/gex                → live chain (computed by the running server)
 *   POST /api/snapshots/mvc      → persist derived MVC row
 *
 * Run on a timer (e.g. Windows Task Scheduler every 30 min). Works headless —
 * does NOT need a browser or the Claude app open, only the dashboard server up.
 *
 * Usage:
 *   node scripts/auto-snapshot-mvc.js                # RTH-only (skips outside 09:30–16:00 ET)
 *   node scripts/auto-snapshot-mvc.js --force        # ignore session gate
 *   node scripts/auto-snapshot-mvc.js --base http://localhost:3002
 *
 * Base URL defaults to BASE_URL env, then http://localhost:3002.
 */

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const baseIdx = args.indexOf("--base");
const BASE =
  (baseIdx !== -1 ? args[baseIdx + 1] : null) ||
  process.env.BASE_URL ||
  "http://localhost:3002";

function nowParts() {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  return {
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

/** RTH = Mon–Fri, 09:30–16:00 ET. */
function isRTH() {
  const { hour, minute, weekday } = nowParts();
  if (["Sat", "Sun"].includes(weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= 570 && mins <= 960;
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d).filter((p) => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function highestRow(chain, field) {
  if (!chain.length) return null;
  return chain.reduce((best, row) =>
    Math.abs(Number(row[field] ?? 0)) > Math.abs(Number(best[field] ?? 0)) ? row : best,
    chain[0]);
}

async function main() {
  if (!FORCE && !isRTH()) {
    console.log(`[auto-mvc] outside RTH (${nowParts().weekday} ${nowParts().hour}:${String(nowParts().minute).padStart(2, "0")} ET) — skipping`);
    return;
  }

  const gexRes = await fetch(`${BASE}/api/gex`, { cache: "no-store" });
  if (!gexRes.ok) throw new Error(`GEX fetch failed: ${gexRes.status}`);
  const data = await gexRes.json();

  const chain = data.chain ?? [];
  if (!chain.length) {
    console.log("[auto-mvc] empty chain (server warming up?) — skipping");
    return;
  }
  const spot = Number(data.spotPrice) || 0;
  const expiry = data.expiration ?? "—";
  const flipPt = data.gexFlip ?? null;
  const esPrice = spot; // server-side: no window.__gexAppState, use spot
  const nearestStrike = spot > 0 ? Math.round(spot / 5) * 5 : null;

  const mvcOIRow = highestRow(chain, "netGEX");
  const mvcVolRow = highestRow(chain, "netVolGEX");
  const dexRow = highestRow(chain, "netDEX");

  const totalNetGEX = chain.reduce((s, r) => s + Number(r.netGEX ?? 0), 0);
  const totalNetGEX_Vol = chain.reduce((s, r) => s + Number(r.netVolGEX ?? 0), 0);
  const totalNetDEX_OI = chain.reduce((s, r) => s + Number(r.netDEX ?? 0), 0);
  const totalNetDEX_Vol = chain.reduce((s, r) => s + Number(r.volNetDEX ?? 0), 0);

  const now = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pctOI_Vol = totalNetGEX !== 0
    ? parseFloat((Math.abs(Number(mvcOIRow?.netGEX ?? 0)) / Math.abs(totalNetGEX) * 100).toFixed(2)) : null;
  const pctVol_Only = totalNetGEX_Vol !== 0
    ? parseFloat((Math.abs(Number(mvcVolRow?.netVolGEX ?? 0)) / Math.abs(totalNetGEX_Vol) * 100).toFixed(2)) : null;
  const gexFlipRaw = Number(flipPt);
  const gexFlip = Number.isFinite(gexFlipRaw) && gexFlipRaw > 500
    ? gexFlipRaw
    : (mvcOIRow?.strike ?? mvcVolRow?.strike ?? null);

  const body = {
    timestamp: now.getTime(),
    date: etDateStr(now),
    day: days[now.getDay()],
    time: now.toTimeString().split(" ")[0],
    strikeOIVol: mvcOIRow?.strike ?? nearestStrike ?? null,
    mvcValueOIVol: Number(mvcOIRow?.netGEX ?? 0),
    pctOI_Vol,
    volumeOIVol: Number(mvcOIRow?.callVolume ?? 0) + Number(mvcOIRow?.putVolume ?? 0),
    totalNetGEX_OI: Math.abs(totalNetGEX),
    strikeVolOnly: mvcVolRow?.strike ?? nearestStrike ?? null,
    mvcValueVolOnly: Number(mvcVolRow?.netVolGEX ?? 0),
    pctVol_Only,
    volumeVolOnly: Number(mvcVolRow?.callVolume ?? 0) + Number(mvcVolRow?.putVolume ?? 0),
    totalNetGEX_Vol,
    spxPrice: spot,
    esPrice,
    netDEXStrike: dexRow?.strike ?? nearestStrike ?? null,
    totalNetDEX_OI,
    totalNetDEX_Vol,
    totalAbsNetGEX: Math.abs(totalNetGEX),
    gexFlip,
    triggerType: "auto-30m",
    expiration: expiry,
  };

  const postRes = await fetch(`${BASE}/api/snapshots/mvc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await postRes.json();
  if (!postRes.ok) throw new Error(`snapshot POST failed: ${postRes.status} ${JSON.stringify(json)}`);
  console.log(`[auto-mvc] ${body.date} ${body.time} ET — saved id ${json.id} · MVC ${body.strikeOIVol} · SPX ${spot}`);
}

main().catch((e) => { console.error("[auto-mvc]", e.message || e); process.exit(1); });
