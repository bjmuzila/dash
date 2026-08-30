// ─────────────────────────────────────────────────────────────────────────────
// Calendar helpers shared by the seasonality view and the almanac.
//
// Two different jobs live here and it matters that they stay separate:
//
//  1. MAPPING A DATE ONTO THE 365-DAY SEASONAL AXIS. Every curve in
//     seasonalityData.ts (SEASONAL_BASELINES, YEAR_CURVES, YTD_2026_*) is laid
//     on a 365-slot calendar axis with 29-Feb DROPPED and weekends/holidays
//     forward-filled. So the index of a date is its NON-LEAP day-of-year minus
//     one, in every year, leap or not — which is why calIndex() uses a fixed
//     month-offset table and never asks the Date object for a day-of-year.
//     Get this wrong in a leap year and every event study silently shifts a day.
//
//  2. ANSWERING "IS TODAY THE LAST TRADING DAY OF THE MONTH". Used to decide
//     whether the month-end section opens itself. Must be evaluated in
//     America/New_York — the market's clock, not the visitor's — or a reader in
//     Sydney gets tomorrow's answer and a reader in Los Angeles gets the right
//     one only after 9pm.
//
// NOTHING HERE MAY BE CALLED DURING RENDER TO SEED STATE. Both jobs depend on
// the wall clock, and the server and the client do not run at the same instant.
// Call these inside an effect. See SeasonalityAlmanac's month-end section.
// ─────────────────────────────────────────────────────────────────────────────

/** Day-of-year index (0-based) of the 1st of each month, NON-LEAP. */
export const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Split "YYYY-MM-DD" into numbers. No Date object — see the header. */
export const parseISO = (iso: string): [number, number, number] => {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
};

/**
 * Index of an ISO date on the 365-slot seasonal axis.
 *
 * 29-Feb maps to the same slot as 28-Feb (index 58), which is exactly what the
 * data generator does when it drops the leap day: the two dates cannot both
 * exist on a 365-slot axis, and the forward-fill makes the collision harmless.
 */
export function calIndex(iso: string): number {
  const [, m, d] = parseISO(iso);
  return MONTH_START[m - 1] + (d - 1);
}

/** "M/D/YYYY" from an ISO date, parsed as plain numbers so no timezone applies. */
export const fmtUSDate = (iso: string): string => {
  const [y, m, d] = parseISO(iso);
  return `${m}/${d}/${y}`;
};

/** "Mon D, YYYY". */
export const fmtLongDate = (iso: string): string => {
  const [y, m, d] = parseISO(iso);
  return `${MONTH_ABBR[m - 1]} ${d}, ${y}`;
};

/** "Aug 27–29" / "Aug 30 – Sep 1" for a symposium's span. */
export function fmtSpan(startISO: string, endISO: string): string {
  const [, sm, sd] = parseISO(startISO);
  const [, em, ed] = parseISO(endISO);
  if (sm === em) return sd === ed ? `${MONTH_ABBR[sm - 1]} ${sd}` : `${MONTH_ABBR[sm - 1]} ${sd}–${ed}`;
  return `${MONTH_ABBR[sm - 1]} ${sd} – ${MONTH_ABBR[em - 1]} ${ed}`;
}

// ── the market's clock ──────────────────────────────────────────────────────

/**
 * Today in America/New_York as "YYYY-MM-DD".
 *
 * en-CA is the locale trick that yields ISO order directly; formatToParts with
 * a hand-assembled string would be the same thing with more code. EFFECT ONLY —
 * this reads the wall clock.
 */
export function nyTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** Day of week, 0=Sun..6=Sat, from Y/M/D with no timezone in play. */
function dayOfWeek(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Easter Sunday (Gregorian, anonymous algorithm) as [month, day]. */
function easter(y: number): [number, number] {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

/**
 * NYSE full-day closure.
 *
 * The full list is here rather than only the two holidays that can actually
 * land on a month's last weekday (Good Friday, Memorial Day), because a reader
 * of this function should not have to re-derive that argument to trust it, and
 * the extra branches cost nothing. Ad-hoc closures — a funeral, Sandy — are NOT
 * modelled; the cost of missing one is that the month-end section opens itself
 * a day early once in a decade.
 */
export function isMarketHoliday(y: number, m: number, d: number): boolean {
  const dow = dayOfWeek(y, m, d);
  if (dow === 0 || dow === 6) return true;

  /** A fixed-date holiday, moved to Friday/Monday when it falls on a weekend. */
  const observed = (hm: number, hd: number): boolean => {
    if (m !== hm) return false;
    const w = dayOfWeek(y, hm, hd);
    if (w === 6) return d === hd - 1;        // Saturday → observed Friday
    if (w === 0) return d === hd + 1;        // Sunday   → observed Monday
    return d === hd;
  };
  /** The nth <weekday> of the month. */
  const nth = (hm: number, weekday: number, n: number): boolean => {
    if (m !== hm) return false;
    const first = dayOfWeek(y, hm, 1);
    return d === 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  };
  /** The LAST <weekday> of the month. */
  const last = (hm: number, weekday: number): boolean => {
    if (m !== hm) return false;
    const dim = daysInMonth(y, hm);
    return d === dim - ((dayOfWeek(y, hm, dim) - weekday + 7) % 7);
  };

  if (observed(1, 1)) return true;            // New Year's Day
  if (nth(1, 1, 3)) return true;              // MLK — 3rd Monday of January
  if (nth(2, 1, 3)) return true;              // Washington's Birthday
  const [em, ed] = easter(y);                 // Good Friday — Easter minus 2
  {
    const gf = new Date(Date.UTC(y, em - 1, ed - 2));
    if (gf.getUTCMonth() + 1 === m && gf.getUTCDate() === d) return true;
  }
  if (last(5, 1)) return true;                // Memorial Day
  if (y >= 2022 && observed(6, 19)) return true; // Juneteenth
  if (observed(7, 4)) return true;            // Independence Day
  if (nth(9, 1, 1)) return true;              // Labor Day
  if (nth(11, 4, 4)) return true;             // Thanksgiving
  if (observed(12, 25)) return true;          // Christmas
  return false;
}

/** ISO date of the last session of a month. */
export function lastTradingDayOfMonth(y: number, m: number): string {
  let d = daysInMonth(y, m);
  while (d > 1 && isMarketHoliday(y, m, d)) d -= 1;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Is `iso` the last session of its own month?
 *
 * The month-end section uses this to open itself. On a weekend it is false by
 * construction — the last session already passed — which is the honest answer:
 * the study is about a session, and there isn't one.
 */
export function isLastTradingDayOfMonth(iso: string): boolean {
  const [y, m] = parseISO(iso);
  return lastTradingDayOfMonth(y, m) === iso;
}
