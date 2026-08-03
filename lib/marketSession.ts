/**
 * marketSession — ET calendar + "is the feed live right now" gates.
 *
 * Extracted verbatim from components/pages/OptionsChain.tsx, which was the only
 * consumer until the phone pages needed the same answers. Two surfaces deciding
 * independently whether the chain is worth re-polling is exactly how the mobile
 * view ends up refreshing at 2am while the desktop sits still (or vice versa),
 * so there is one copy and both import it.
 *
 * Everything here works in ET regardless of the device's timezone: `etToday()`
 * round-trips through toLocaleString so a phone in London still gets the New
 * York wall clock.
 */

export function etToday(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

export function etDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isHoliday(date: Date): boolean {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();

  // US market holidays (non-exhaustive, add more as needed)
  const holidays: Array<[number, number]> = [
    [1, 1],    // New Year's Day
    [7, 4],    // Independence Day
    [12, 25],  // Christmas
  ];

  // Check fixed holidays
  if (holidays.some(([m, d]) => month === m && day === d)) return true;

  // Observed holidays: a fixed holiday on Sat is observed the Fri before;
  // on Sun it's observed the Mon after. (e.g. Jul 4 2026 = Sat → Fri Jul 3.)
  const dow = date.getDay();
  if (dow === 5) { // Friday — is tomorrow (Sat) a fixed holiday?
    const sat = new Date(year, date.getMonth(), day + 1);
    if (holidays.some(([m, d]) => sat.getMonth() + 1 === m && sat.getDate() === d)) return true;
  }
  if (dow === 1) { // Monday — was yesterday (Sun) a fixed holiday?
    const sun = new Date(year, date.getMonth(), day - 1);
    if (holidays.some(([m, d]) => sun.getMonth() + 1 === m && sun.getDate() === d)) return true;
  }

  // MLK Day (3rd Monday in January)
  if (month === 1) {
    const firstDay = new Date(year, 0, 1).getDay();
    const mlkDay = 15 + ((8 - firstDay) % 7);
    if (day === mlkDay) return true;
  }

  // Presidents Day (3rd Monday in February)
  if (month === 2) {
    const firstDay = new Date(year, 1, 1).getDay();
    const presDay = 15 + ((8 - firstDay) % 7);
    if (day === presDay) return true;
  }

  // Memorial Day (last Monday in May)
  if (month === 5) {
    const lastDay = new Date(year, 5, 0).getDate();
    const lastMonday = lastDay - ((new Date(year, 4, lastDay).getDay() + 1) % 7);
    if (day === lastMonday) return true;
  }

  // Labor Day (1st Monday in September)
  if (month === 9) {
    const firstDay = new Date(year, 8, 1).getDay();
    const laborDay = 1 + ((8 - firstDay) % 7);
    if (day === laborDay) return true;
  }

  // Thanksgiving (4th Thursday in November)
  if (month === 11) {
    const firstDay = new Date(year, 10, 1).getDay();
    const thanksgiving = 22 + ((5 - firstDay) % 7);
    if (day === thanksgiving) return true;
  }

  return false;
}

export function isTradingDay(date: Date): boolean {
  const dayOfWeek = date.getDay();
  // Skip weekends (0 = Sunday, 6 = Saturday)
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  // Skip holidays
  if (isHoliday(date)) return false;
  return true;
}

// True during the live RTH session (9:30–16:00 ET on a trading day). Per-strike
// volume only accumulates from real session prints, so it reads 0 from 9:00–9:30
// even though OI (settled overnight) is already populated. We poll the chain
// through the session so volume climbs as trades print instead of staying frozen
// at the stale 0 from the page's one-shot load.
export function isSessionLive(): boolean {
  const et = etToday();
  if (!isTradingDay(et)) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// SPX-only extended feed: SPX keeps updating ~24/7 across the trading WEEK
// (Sunday 8pm ET → Friday 4pm ET), EXCEPT a daily 4–6pm ET maintenance window
// where nothing refreshes. Other tickers freeze outside RTH (isSessionLive).
// Used to gate the chain poll so SPX stays live after hours but equities don't.
export function isSpxFeedLive(): boolean {
  const et = etToday();
  const dow = et.getDay();              // 0=Sun .. 6=Sat
  const mins = et.getHours() * 60 + et.getMinutes();
  // Daily maintenance break 16:00–18:00 ET — no updates any day.
  if (mins >= 16 * 60 && mins < 18 * 60) return false;
  // Saturday: closed all day.
  if (dow === 6) return false;
  // Sunday: only open from 20:00 ET onward (futures/Globex reopen).
  if (dow === 0) return mins >= 20 * 60;
  // Friday: closes at 16:00 ET (the 16:00 break above already blocks 16–18;
  // after 18:00 Fri it stays closed for the weekend).
  if (dow === 5) return mins < 16 * 60;
  // Mon–Thu: open all day except the 16–18 break handled above.
  return true;
}
