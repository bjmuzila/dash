/**
 * Synthetic customers for the customer card sandbox.
 *
 * Nothing here is a real person, a real email, a real IP or a real payment.
 * The shapes are the ones the owner console already has (subscription state,
 * Stripe money, the page feed) so the card can be pointed at the live endpoint
 * later without the layout moving.
 */

export type SubState = "cancelling" | "active" | "past_due" | "trial";

export type FeedEvent = {
  /** Local clock, 24h. */
  at: string;
  /** APP is behind the login. PUB is the marketing site. */
  kind: "APP" | "PUB";
  label: string;
  path: string;
  /** Seconds on the page, a lower bound. */
  seconds: number;
  /** A one word marker rendered beside the row, for the thing that happened here. */
  flag?: string;
};

export type FeedDay = {
  /** "Yesterday", "Mon 15 Sep", and so on. */
  day: string;
  loads: number;
  pages: number;
  seconds: number;
};

export type PageShare = { label: string; seconds: number };

export type Customer = {
  id: string;
  name: string;
  email: string;
  initials: string;

  state: SubState;
  stateNote: string;
  plan: string;
  price: string;
  coupon?: string;
  discord?: string;

  location: string;
  ip: string;
  memberSince: string;
  memberFor: string;
  lastLogin: string;
  logins: number;
  cameFrom: string;
  device: string;
  emailPref: "subscribed" | "unsubscribed";

  totalSpent: string;
  planLine: string;
  couponLine: string;
  renews: string;
  reason?: string;
  failedPays: number;

  loads: number;
  sessions: number;
  timeLabel: string;
  pagesSeen: number;
  mostViewed: string;
  tickers: string;
  feedback: string;

  /** Today's rows, newest last, the way a session reads. */
  today: FeedEvent[];
  /** Everything before today, one row per day. */
  earlier: FeedDay[];
  pages: PageShare[];
};

export const CUSTOMERS: Customer[] = [
  {
    id: "dan",
    name: "Dan Hoffman",
    email: "dan.h@proton.me",
    initials: "DH",

    state: "cancelling",
    stateNote: "ends Sep 30",
    plan: "Monthly",
    price: "$49",
    coupon: "FOMC50",
    discord: "@danh",

    location: "Austin, TX · US",
    ip: "73.21.•.•",
    memberSince: "Mar 14, 2026",
    memberFor: "6 mo",
    lastLogin: "Today 09:41 ET",
    logins: 38,
    cameFrom: "Email · fomc-half-off",
    device: "Chrome · Windows · desktop",
    emailPref: "subscribed",

    totalSpent: "$294.00",
    planLine: "Monthly · $49 · 6 invoices",
    couponLine: "FOMC50 · 50% off first month",
    renews: "Does not renew (cancel at period end)",
    reason: 'Too expensive · "Not trading enough right now"',
    failedPays: 0,

    loads: 212,
    sessions: 31,
    timeLabel: "9h 12m",
    pagesSeen: 7,
    mostViewed: "/home",
    tickers: "NVDA, TSLA",
    feedback: "1 open",

    today: [
      { at: "09:41", kind: "APP", label: "Home", path: "/home", seconds: 860 },
      { at: "09:55", kind: "APP", label: "Multi Greek", path: "/mult-greek", seconds: 362 },
      { at: "10:01", kind: "APP", label: "ES Candles", path: "/es-candles", seconds: 1360 },
      { at: "10:24", kind: "APP", label: "Options Chain", path: "/options-chain", seconds: 191 },
      { at: "10:27", kind: "PUB", label: "Pricing", path: "/pricing", seconds: 65 },
      { at: "10:28", kind: "APP", label: "Account", path: "/account", seconds: 150, flag: "cancelled here" },
    ],
    earlier: [
      { day: "Yesterday", loads: 18, pages: 5, seconds: 2460 },
      { day: "Mon 14 Sep", loads: 9, pages: 4, seconds: 1320 },
      { day: "Fri 11 Sep", loads: 22, pages: 6, seconds: 3180 },
      { day: "Thu 10 Sep", loads: 14, pages: 5, seconds: 2040 },
    ],
    pages: [
      { label: "ES Candles", seconds: 13200 },
      { label: "Home", seconds: 7500 },
      { label: "Multi Greek", seconds: 4920 },
      { label: "Options Chain", seconds: 3480 },
      { label: "Est. Moves", seconds: 1620 },
    ],
  },

  {
    id: "brandonk",
    name: "Brandon Keller",
    email: "brandon.k@gmail.com",
    initials: "BK",

    state: "active",
    stateNote: "renews Oct 02",
    plan: "Annual",
    price: "$399",
    discord: "@bkeller",

    location: "Naperville, IL · US",
    ip: "24.14.•.•",
    memberSince: "Oct 02, 2025",
    memberFor: "11 mo",
    lastLogin: "Today 08:12 ET",
    logins: 224,
    cameFrom: "X · thread on gamma flip",
    device: "Chrome · macOS · desktop",
    emailPref: "subscribed",

    totalSpent: "$798.00",
    planLine: "Annual · $399 · 2 invoices",
    couponLine: "None",
    renews: "Oct 02, 2026 · $399",
    failedPays: 0,

    loads: 1180,
    sessions: 96,
    timeLabel: "48h 30m",
    pagesSeen: 11,
    mostViewed: "/es-candles",
    tickers: "SPX, ES, NQ",
    feedback: "3 closed",

    today: [
      { at: "08:12", kind: "APP", label: "Home", path: "/home", seconds: 240 },
      { at: "08:16", kind: "APP", label: "ES Candles", path: "/es-candles", seconds: 4200 },
      { at: "09:26", kind: "APP", label: "GEX Candles", path: "/gex-candles", seconds: 2760 },
      { at: "10:12", kind: "APP", label: "Scanner", path: "/scanner", seconds: 900 },
      { at: "10:27", kind: "APP", label: "Options Chain", path: "/options-chain", seconds: 660 },
    ],
    earlier: [
      { day: "Yesterday", loads: 41, pages: 8, seconds: 9600 },
      { day: "Mon 14 Sep", loads: 37, pages: 7, seconds: 8100 },
      { day: "Fri 11 Sep", loads: 44, pages: 9, seconds: 11400 },
      { day: "Thu 10 Sep", loads: 39, pages: 8, seconds: 9000 },
    ],
    pages: [
      { label: "ES Candles", seconds: 61200 },
      { label: "GEX Candles", seconds: 42600 },
      { label: "Scanner", seconds: 21000 },
      { label: "Home", seconds: 12600 },
      { label: "Options Chain", seconds: 9000 },
    ],
  },

  {
    id: "mtorres",
    name: "Marisol Torres",
    email: "m.torres@outlook.com",
    initials: "MT",

    state: "past_due",
    stateNote: "retry Sep 18",
    plan: "Monthly",
    price: "$49",

    location: "Miami, FL · US",
    ip: "98.202.•.•",
    memberSince: "Jun 21, 2026",
    memberFor: "3 mo",
    lastLogin: "Sep 12, 16:04 ET",
    logins: 27,
    cameFrom: "Discord · #general invite",
    device: "Safari · iOS · phone",
    emailPref: "subscribed",

    totalSpent: "$98.00",
    planLine: "Monthly · $49 · 2 invoices",
    couponLine: "None",
    renews: "Blocked · card declined twice",
    reason: "Payment failed · insufficient funds",
    failedPays: 2,

    loads: 88,
    sessions: 19,
    timeLabel: "3h 48m",
    pagesSeen: 5,
    mostViewed: "/mobile",
    tickers: "SPY",
    feedback: "None",

    today: [],
    earlier: [
      { day: "Sat 12 Sep", loads: 6, pages: 3, seconds: 780 },
      { day: "Thu 10 Sep", loads: 11, pages: 4, seconds: 1500 },
      { day: "Tue 08 Sep", loads: 8, pages: 3, seconds: 960 },
    ],
    pages: [
      { label: "Mobile board", seconds: 6600 },
      { label: "Home", seconds: 3000 },
      { label: "Est. Moves", seconds: 2100 },
      { label: "Account", seconds: 1200 },
      { label: "Pricing", seconds: 780 },
    ],
  },

  {
    id: "sarahw",
    name: "Sarah Whitfield",
    email: "sarah.w@yahoo.com",
    initials: "SW",

    state: "trial",
    stateNote: "day 3 of 7",
    plan: "Trial",
    price: "$0",
    coupon: "FOMC50",
    discord: "@swhit",

    location: "Portland, OR · US",
    ip: "50.39.•.•",
    memberSince: "Sep 13, 2026",
    memberFor: "3 d",
    lastLogin: "Today 07:02 ET",
    logins: 9,
    cameFrom: "Email · fomc-half-off",
    device: "Firefox · Windows · desktop",
    emailPref: "subscribed",

    totalSpent: "$0.00",
    planLine: "Trial · converts to Monthly $49",
    couponLine: "FOMC50 · 50% off first month, unused",
    renews: "Sep 20, 2026 · first charge $24.50",
    failedPays: 0,

    loads: 46,
    sessions: 8,
    timeLabel: "2h 06m",
    pagesSeen: 6,
    mostViewed: "/home",
    tickers: "SPX, AAPL",
    feedback: "1 open",

    today: [
      { at: "07:02", kind: "APP", label: "Home", path: "/home", seconds: 420, flag: "first login of day" },
      { at: "07:09", kind: "APP", label: "Est. Moves", path: "/est-moves", seconds: 540 },
      { at: "07:18", kind: "APP", label: "GEX Candles", path: "/gex-candles", seconds: 1080 },
      { at: "07:36", kind: "PUB", label: "Pricing", path: "/pricing", seconds: 145 },
    ],
    earlier: [
      { day: "Yesterday", loads: 14, pages: 5, seconds: 2280 },
      { day: "Mon 14 Sep", loads: 12, pages: 4, seconds: 1860 },
    ],
    pages: [
      { label: "Home", seconds: 2700 },
      { label: "GEX Candles", seconds: 2280 },
      { label: "Est. Moves", seconds: 1440 },
      { label: "Pricing", seconds: 600 },
      { label: "Options Chain", seconds: 540 },
    ],
  },
];

/** "22m 40s", "3h 40m", "1m 05s". Never a bare decimal. */
export function dur(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
