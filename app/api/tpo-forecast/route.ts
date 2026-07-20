import { NextRequest, NextResponse } from "next/server";
import { getEsCandles, queryAll, type EsCandleDbRecord } from "@/lib/db";
import { buildTpoSession, type TpoSession } from "@/lib/tpo";
import { rthBarsForDate } from "@/lib/balanceImbalance";
import type { EsCandle } from "@/hooks/useEsCandles";

// TPO time-profile forecaster (live).
//   GET ?symbol=ES  → predict today's full-day TPO profile from the Initial
//                     Balance, using k-NN over the tpo_profiles history the
//                     nightly recorder writes. Returns predicted vs realized-
//                     so-far densities on a shared price axis + confidence.
//
// The predictor mirrors analyze/tpo_forecast.py: match today's IB-shape features
// to the most similar past days, average their realized profiles (aligned on
// IB-mid), and re-center on today's IB-mid. No lookahead — history only.

export const dynamic = "force-dynamic";

const BIN = 1;
const GRID_LO = -100, GRID_HI = 100;            // offset (pts) vs IB mid
const GRID_N = (GRID_HI - GRID_LO) / BIN + 1;
const K = 25;
const LIVE_MIN = 40;                            // history rows needed to light up
const IB_CLOSE_MIN = 630;                       // 10:30 ET — IB complete

function etDateStr(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d).filter((p) => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function etNowMin(): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const h = Number(p.find((x) => x.type === "hour")?.value);
  const m = Number(p.find((x) => x.type === "minute")?.value);
  return h * 60 + m;
}

interface ProfRow {
  date: string; poc: number; vah: number; val: number;
  ib_high: number | null; ib_low: number | null; ib_mid: number | null; ib_range: number | null;
  day_open: number | null; day_close: number | null; day_high: number | null; day_low: number | null;
  profile_json: { price: number; count: number }[];
}

// bins ([{price,count}]) → normalized density on the offset grid vs `anchor`
function toDensity(bins: { price: number; count: number }[], anchor: number): number[] {
  const d = new Array(GRID_N).fill(0);
  let sum = 0;
  for (const b of bins) {
    const idx = Math.round((b.price - anchor - GRID_LO) / BIN);
    if (idx >= 0 && idx < GRID_N) { d[idx] += b.count; sum += b.count; }
  }
  if (sum > 0) for (let i = 0; i < GRID_N; i++) d[i] /= sum;
  return d;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// IB-shape feature vector for one day (prev = the row before it)
function features(r: ProfRow, prev: ProfRow | null, trailIb: number, trailRng: number): number[] {
  const ibMid = r.ib_mid ?? 0, ibRng = r.ib_range || 1;
  const gap = prev?.day_close != null && r.day_open != null ? r.day_open - prev.day_close : 0;
  const prevPocOff = prev?.poc != null ? prev.poc - ibMid : 0;
  const prevRng = prev?.day_high != null && prev?.day_low != null ? prev.day_high - prev.day_low : 0;
  return [
    ibRng / (trailIb || 1),
    r.day_open != null ? (r.day_open - ibMid) / ibRng : 0,
    gap / (trailIb || 1),
    prevPocOff / (trailIb || 1),
    prevRng / (trailRng || 1),
  ];
}

// contiguous value area interval (indices) from a density
function vaBand(dens: number[], pct = 0.7): [number, number] {
  let poc = 0; for (let i = 1; i < dens.length; i++) if (dens[i] > dens[poc]) poc = i;
  const tot = dens.reduce((s, x) => s + x, 0);
  let lo = poc, hi = poc, acc = dens[poc];
  while (acc < tot * pct && (lo > 0 || hi < dens.length - 1)) {
    const below = lo > 0 ? dens[lo - 1] : -1;
    const above = hi < dens.length - 1 ? dens[hi + 1] : -1;
    if (above >= below) { hi++; acc += Math.max(0, above); } else { lo--; acc += Math.max(0, below); }
  }
  return [lo, hi];
}

export async function GET(req: NextRequest) {
  try {
    const u = new URL(req.url);
    const symbol = (u.searchParams.get("symbol") || "ES").toUpperCase() === "NQ" ? "NQU" : "ESU";
    const today = etDateStr();

    // history from the recorder (may not exist yet → treat as empty)
    let hist: ProfRow[] = [];
    try {
      hist = await queryAll<ProfRow>(
        `SELECT date, poc, vah, val, ib_high, ib_low, ib_mid, ib_range,
                day_open, day_close, day_high, day_low, profile_json
           FROM tpo_profiles WHERE symbol = ? AND date < ? ORDER BY date ASC`,
        [symbol, today]
      );
    } catch {
      return NextResponse.json({ ok: false, status: "accumulating", nHistory: 0, need: LIVE_MIN,
        note: "Recorder table not created yet — deploys with the nightly recorder." });
    }

    // today's session so far (need IB complete)
    const rows = await getEsCandles(today, undefined, 2000);
    const bars = rthBarsForDate(rows as unknown as EsCandle[], today);
    const todaySess: TpoSession | null = bars.length >= 3 ? buildTpoSession(bars, today, BIN) : null;
    const ibDone = etNowMin() >= IB_CLOSE_MIN && todaySess?.ibHigh != null && todaySess?.ibLow != null;

    if (hist.length < LIVE_MIN) {
      return NextResponse.json({ ok: false, status: "accumulating", nHistory: hist.length, need: LIVE_MIN,
        note: "The forecast lights up once the recorder (or a one-time backfill) has enough sessions." });
    }
    if (!todaySess || !ibDone) {
      return NextResponse.json({ ok: false, status: "pre_ib", nHistory: hist.length,
        note: "Waiting on the Initial Balance (first two 30-min periods) to complete." });
    }

    const ibMid = (todaySess.ibHigh! + todaySess.ibLow!) / 2;

    // features for every history row + today (trailing 20-session medians)
    const feat: number[][] = [];
    for (let i = 0; i < hist.length; i++) {
      const win = hist.slice(Math.max(0, i - 20), i);
      const trailIb = median(win.map((x) => x.ib_range || 0)) || (hist[i].ib_range || 1);
      const trailRng = median(win.map((x) => (x.day_high ?? 0) - (x.day_low ?? 0))) || 1;
      feat.push(features(hist[i], i > 0 ? hist[i - 1] : null, trailIb, trailRng));
    }
    const winT = hist.slice(-20);
    const trailIbT = median(winT.map((x) => x.ib_range || 0)) || (todaySess.ibRange || 1);
    const trailRngT = median(winT.map((x) => (x.day_high ?? 0) - (x.day_low ?? 0))) || 1;
    const todayRow: ProfRow = {
      date: today, poc: todaySess.poc, vah: todaySess.vah, val: todaySess.val,
      ib_high: todaySess.ibHigh, ib_low: todaySess.ibLow, ib_mid: ibMid, ib_range: todaySess.ibRange,
      day_open: todaySess.open, day_close: null, day_high: null, day_low: null, profile_json: [],
    };
    const qf = features(todayRow, hist[hist.length - 1], trailIbT, trailRngT);

    // standardize on history
    const dims = qf.length;
    const mu = new Array(dims).fill(0), sd = new Array(dims).fill(0);
    for (const f of feat) for (let j = 0; j < dims; j++) mu[j] += f[j] / feat.length;
    for (const f of feat) for (let j = 0; j < dims; j++) sd[j] += (f[j] - mu[j]) ** 2 / feat.length;
    for (let j = 0; j < dims; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    const norm = (f: number[]) => f.map((v, j) => (v - mu[j]) / sd[j]);
    const qn = norm(qf);

    // k-NN by euclidean distance; inverse-distance weighted avg of realized densities
    const dist = feat.map((f, i) => {
      const fn = norm(f); let s = 0;
      for (let j = 0; j < dims; j++) s += (fn[j] - qn[j]) ** 2;
      return { i, d: Math.sqrt(s) };
    }).sort((a, b) => a.d - b.d);
    const nn = dist.slice(0, K);
    const wsum = nn.reduce((s, x) => s + 1 / (x.d + 1e-6), 0);
    const pred = new Array(GRID_N).fill(0);
    for (const { i, d } of nn) {
      const w = (1 / (d + 1e-6)) / wsum;
      const dens = toDensity(hist[i].profile_json || [], hist[i].ib_mid ?? 0);
      for (let g = 0; g < GRID_N; g++) pred[g] += dens[g] * w;
    }

    // realized-so-far (today), aligned to today's IB mid
    const realized = toDensity(todaySess.bins.map((b) => ({ price: b.price, count: b.count })), ibMid);

    // confidence: how tight are the k neighbours vs the overall spread
    const medAll = median(dist.map((x) => x.d)) || 1;
    const meanK = nn.reduce((s, x) => s + x.d, 0) / nn.length;
    const confidence = Math.max(0, Math.min(100, Math.round(100 * (1 - meanK / medAll))));

    // to price axis + VA/POC markers
    const prices = Array.from({ length: GRID_N }, (_, g) => GRID_LO + g * BIN + ibMid);
    const predMax = Math.max(...pred, 1e-9), realMax = Math.max(...realized, 1e-9);
    const [pvl, pvh] = vaBand(pred), [rvl, rvh] = vaBand(realized);

    return NextResponse.json({
      ok: true, symbol, date: today, nHistory: hist.length, k: K, confidence,
      ibMid, ibHigh: todaySess.ibHigh, ibLow: todaySess.ibLow, spot: bars[bars.length - 1]?.close ?? null,
      prices,
      predicted: pred.map((v) => v / predMax),
      realized: realized.map((v) => v / realMax),
      predicted_poc: prices[pred.indexOf(Math.max(...pred))],
      realized_poc: prices[realized.indexOf(Math.max(...realized))],
      predicted_va: [prices[pvl], prices[pvh]],
      realized_va: [prices[rvl], prices[rvh]],
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
