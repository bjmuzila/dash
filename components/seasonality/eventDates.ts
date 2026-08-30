// ─────────────────────────────────────────────────────────────────────────────
// Event calendars for the seasonality almanac's event studies.
//
// HAND-MAINTAINED, not auto-generated — unlike seasonalityData.ts, which is
// recomputed from price history. These are CALENDARS: the dates the world put
// on a schedule. There is no feed for them, so they are typed in once, sourced,
// and appended to once a year.
//
// Every date below was confirmed against a primary source (see the per-list
// comments). Do NOT add a row you have not confirmed — the whole value of an
// event study is that the anchor date is right, and a wrong anchor silently
// produces a plausible-looking wrong number rather than an error.
//
// The RETURNS around these dates are NOT stored here. They are computed at
// render time — Jackson Hole from the YEAR_CURVES already in the bundle, Apple
// from the AAPL daily history the page fetches from /api/public-daily. That
// keeps this file a calendar and nothing else, so appending next year's date is
// a one-line change with no data regeneration.
// ─────────────────────────────────────────────────────────────────────────────

// ── Jackson Hole ────────────────────────────────────────────────────────────
//
// The Kansas City Fed's Economic Policy Symposium. Thursday–Saturday in late
// August, and the FRIDAY is the one that matters: that is when the Chair
// speaks. `keynote` is the anchor every number in the UI is measured from.
//
// Sources: Kansas City Fed press releases and the symposium proceedings
// archive (kansascityfed.org), the RePEc/Fed-in-Print proceedings series, and
// the Federal Reserve Board speech archive — a Chair's "At the Jackson Hole
// Economic Policy Symposium… Jackson Hole, Wyoming" speech date pins the Friday
// directly for most years since 2006.
//
// TWO YEARS BREAK THE PATTERN, and both are marked in `note`:
//   • 2020 — virtual, TWO days, and the keynote was on the THURSDAY.
//   • 2021 — planned in-person Aug 26–28, then moved online and compressed to
//     ONE day, Friday Aug 27. Recorded as held, not as scheduled.
// Four years spill into September: 1995, 2001, 2007, 2012.
//
// 1990 is the floor because that is where the VIX study's data starts and it is
// already far more history than the event has signal.

export type JacksonHole = {
  year: number;
  /** Symposium opening day (normally Thursday). */
  start: string;
  /** Symposium closing day (normally Saturday). */
  end: string;
  /** The Chair's speech day. THE anchor — every window is measured off this. */
  keynote: string;
  /** Official proceedings title for that year's programme. */
  theme: string;
  /** Set only where the year deviates from Thu–Sat / Friday keynote. */
  note?: string;
};

export const JACKSON_HOLE: JacksonHole[] = [
  { year: 2026, start: "2026-08-27", end: "2026-08-29", keynote: "2026-08-28", theme: "Financial Innovation: Implications for Payments and Policy" },
  { year: 2025, start: "2025-08-21", end: "2025-08-23", keynote: "2025-08-22", theme: "Labor Markets in Transition: Demographics, Productivity and Macroeconomic Policy" },
  { year: 2024, start: "2024-08-22", end: "2024-08-24", keynote: "2024-08-23", theme: "Reassessing the Effectiveness and Transmission of Monetary Policy" },
  { year: 2023, start: "2023-08-24", end: "2023-08-26", keynote: "2023-08-25", theme: "Structural Shifts in the Global Economy" },
  { year: 2022, start: "2022-08-25", end: "2022-08-27", keynote: "2022-08-26", theme: "Reassessing Constraints on the Economy and Policy" },
  { year: 2021, start: "2021-08-27", end: "2021-08-27", keynote: "2021-08-27", theme: "Macroeconomic Policy in an Uneven Economy", note: "Virtual — compressed to a single day" },
  { year: 2020, start: "2020-08-27", end: "2020-08-28", keynote: "2020-08-27", theme: "Navigating the Decade Ahead: Implications for Monetary Policy", note: "Virtual — two days, keynote on the Thursday" },
  { year: 2019, start: "2019-08-22", end: "2019-08-24", keynote: "2019-08-23", theme: "Challenges for Monetary Policy" },
  { year: 2018, start: "2018-08-23", end: "2018-08-25", keynote: "2018-08-24", theme: "Changing Market Structures and Implications for Monetary Policy" },
  { year: 2017, start: "2017-08-24", end: "2017-08-26", keynote: "2017-08-25", theme: "Fostering a Dynamic Global Economy" },
  { year: 2016, start: "2016-08-25", end: "2016-08-27", keynote: "2016-08-26", theme: "Designing Resilient Monetary Policy Frameworks for the Future" },
  { year: 2015, start: "2015-08-27", end: "2015-08-29", keynote: "2015-08-28", theme: "Inflation Dynamics and Monetary Policy", note: "No Chair keynote — Yellen did not attend" },
  { year: 2014, start: "2014-08-21", end: "2014-08-23", keynote: "2014-08-22", theme: "Re-Evaluating Labor Market Dynamics" },
  { year: 2013, start: "2013-08-22", end: "2013-08-24", keynote: "2013-08-23", theme: "Global Dimensions of Unconventional Monetary Policy", note: "No Chair keynote — Bernanke did not attend" },
  { year: 2012, start: "2012-08-30", end: "2012-09-01", keynote: "2012-08-31", theme: "The Changing Policy Landscape" },
  { year: 2011, start: "2011-08-25", end: "2011-08-27", keynote: "2011-08-26", theme: "Achieving Maximum Long-Run Growth" },
  { year: 2010, start: "2010-08-26", end: "2010-08-28", keynote: "2010-08-27", theme: "Macroeconomic Challenges: The Decade Ahead" },
  { year: 2009, start: "2009-08-20", end: "2009-08-22", keynote: "2009-08-21", theme: "Financial Stability and Macroeconomic Policy" },
  { year: 2008, start: "2008-08-21", end: "2008-08-23", keynote: "2008-08-22", theme: "Maintaining Stability in a Changing Financial System" },
  { year: 2007, start: "2007-08-30", end: "2007-09-01", keynote: "2007-08-31", theme: "Housing, Housing Finance, and Monetary Policy" },
  { year: 2006, start: "2006-08-24", end: "2006-08-26", keynote: "2006-08-25", theme: "The New Economic Geography: Effects and Policy Implications" },
  { year: 2005, start: "2005-08-25", end: "2005-08-27", keynote: "2005-08-26", theme: "The Greenspan Era: Lessons for the Future" },
  { year: 2004, start: "2004-08-26", end: "2004-08-28", keynote: "2004-08-27", theme: "Global Demographic Change: Economic Impacts and Policy Challenges" },
  { year: 2003, start: "2003-08-28", end: "2003-08-30", keynote: "2003-08-29", theme: "Monetary Policy and Uncertainty: Adapting to a Changing Economy" },
  { year: 2002, start: "2002-08-29", end: "2002-08-31", keynote: "2002-08-30", theme: "Rethinking Stabilization Policy" },
  { year: 2001, start: "2001-08-30", end: "2001-09-01", keynote: "2001-08-31", theme: "Economic Policy for the Information Economy" },
  { year: 2000, start: "2000-08-24", end: "2000-08-26", keynote: "2000-08-25", theme: "Global Economic Integration: Opportunities and Challenges" },
  { year: 1999, start: "1999-08-26", end: "1999-08-28", keynote: "1999-08-27", theme: "New Challenges for Monetary Policy" },
  { year: 1998, start: "1998-08-27", end: "1998-08-29", keynote: "1998-08-28", theme: "Income Inequality: Issues and Policy Options" },
  { year: 1997, start: "1997-08-28", end: "1997-08-30", keynote: "1997-08-29", theme: "Maintaining Financial Stability in a Global Economy" },
  { year: 1996, start: "1996-08-29", end: "1996-08-31", keynote: "1996-08-30", theme: "Achieving Price Stability" },
  { year: 1995, start: "1995-08-31", end: "1995-09-02", keynote: "1995-09-01", theme: "Budget Deficits and Debt: Issues and Options" },
  { year: 1994, start: "1994-08-25", end: "1994-08-27", keynote: "1994-08-26", theme: "Reducing Unemployment: Current Issues and Policy Options" },
  { year: 1993, start: "1993-08-19", end: "1993-08-21", keynote: "1993-08-20", theme: "Changing Capital Markets: Implications for Monetary Policy" },
  { year: 1992, start: "1992-08-27", end: "1992-08-29", keynote: "1992-08-28", theme: "Policies for Long-Run Economic Growth" },
  { year: 1991, start: "1991-08-22", end: "1991-08-24", keynote: "1991-08-23", theme: "Policy Implications of Trade and Currency Zones" },
  { year: 1990, start: "1990-08-23", end: "1990-08-25", keynote: "1990-08-24", theme: "Central Banking Issues in Emerging Market-Oriented Economies" },
];

// ── Apple product events ────────────────────────────────────────────────────
//
// Apple's own keynotes only. NOT earnings, not shareholder meetings, and not
// press-release launches with no event — a study of "how does the stock react
// to a keynote" is worthless if half the rows are not keynotes.
//
// `date` is the US Pacific calendar date of the keynote. Apple runs these at
// 10:00 PT / 13:00 ET, so the event lands INSIDE the cash session: the day-of
// return is a real reaction, not an overnight gap.
//
// Sources: Apple Newsroom, Apple's own event archive, Wikipedia's "List of
// Apple Inc. media events" (cross-checked, and two of its dates corrected —
// the October 2013 event was the 22nd and "Back to the Mac" was 2010-10-20),
// MacRumors' event guide and the appleinvites.com invitation archive.
//
// `kind` groups them so the table can be filtered:
//   wwdc      — the WWDC opening keynote (software, developers)
//   september — the annual fall iPhone keynote, even the years it slipped to
//               October (2011 "Let's Talk iPhone", 2020 "Hi, Speed")
//   spring    — a spring/March–May event
//   october   — a fall Mac & iPad event, including 2020's November "One More
//               Thing"
//   other     — Macworld keynotes and one-off announcement events

export type AppleEventKind = "wwdc" | "september" | "spring" | "october" | "other";

export type AppleEvent = {
  /** Keynote day, US Pacific. */
  date: string;
  /** Event name, or its common name where Apple never gave it one. */
  name: string;
  kind: AppleEventKind;
  /** The headline product. Short — it is a table column. */
  headline: string;
};

export const APPLE_EVENT_KINDS: { k: AppleEventKind | "all"; label: string }[] = [
  { k: "all", label: "All events" },
  { k: "september", label: "September / iPhone" },
  { k: "wwdc", label: "WWDC" },
  { k: "spring", label: "Spring" },
  { k: "october", label: "Fall Mac / iPad" },
  { k: "other", label: "Other" },
];

/** Newest first — the table renders in this order. */
export const APPLE_EVENTS: AppleEvent[] = [
  { date: "2026-06-08", name: "WWDC 2026 Keynote", kind: "wwdc", headline: "iOS 27 / macOS 27" },
  { date: "2026-03-04", name: "Special Apple Experience", kind: "spring", headline: "MacBook Neo / M5 MacBook Air" },
  { date: "2025-09-09", name: "Awe Dropping", kind: "september", headline: "iPhone 17 / iPhone Air" },
  { date: "2025-06-09", name: "WWDC 2025 Keynote", kind: "wwdc", headline: "iOS 26 / Liquid Glass" },
  { date: "2024-09-09", name: "It's Glowtime", kind: "september", headline: "iPhone 16 / Watch Series 10" },
  { date: "2024-06-10", name: "WWDC 2024 Keynote", kind: "wwdc", headline: "Apple Intelligence" },
  { date: "2024-05-07", name: "Let Loose", kind: "spring", headline: "M4 iPad Pro / Pencil Pro" },
  { date: "2023-10-30", name: "Scary Fast", kind: "october", headline: "M3 MacBook Pro / iMac" },
  { date: "2023-09-12", name: "Wonderlust", kind: "september", headline: "iPhone 15 / USB-C" },
  { date: "2023-06-05", name: "WWDC 2023 Keynote", kind: "wwdc", headline: "Vision Pro" },
  { date: "2022-09-07", name: "Far Out", kind: "september", headline: "iPhone 14 / Watch Ultra" },
  { date: "2022-06-06", name: "WWDC 2022 Keynote", kind: "wwdc", headline: "M2 MacBook Air / iOS 16" },
  { date: "2022-03-08", name: "Peek Performance", kind: "spring", headline: "Mac Studio / M1 Ultra" },
  { date: "2021-10-18", name: "Unleashed", kind: "october", headline: "M1 Pro / Max MacBook Pro" },
  { date: "2021-09-14", name: "California Streaming", kind: "september", headline: "iPhone 13 / Watch Series 7" },
  { date: "2021-06-07", name: "WWDC 2021 Keynote", kind: "wwdc", headline: "iOS 15 / macOS Monterey" },
  { date: "2021-04-20", name: "Spring Loaded", kind: "spring", headline: "AirTag / M1 iMac" },
  { date: "2020-11-10", name: "One More Thing", kind: "october", headline: "Apple Silicon M1 Macs" },
  { date: "2020-10-13", name: "Hi, Speed", kind: "september", headline: "iPhone 12 / 5G" },
  { date: "2020-09-15", name: "Time Flies", kind: "september", headline: "Watch Series 6 / iPad Air" },
  { date: "2020-06-22", name: "WWDC 2020 Keynote", kind: "wwdc", headline: "Apple silicon transition" },
  { date: "2019-09-10", name: "By Innovation Only", kind: "september", headline: "iPhone 11 / 11 Pro" },
  { date: "2019-06-03", name: "WWDC 2019 Keynote", kind: "wwdc", headline: "Mac Pro / iPadOS" },
  { date: "2019-03-25", name: "It's Show Time", kind: "spring", headline: "Apple TV+ / Apple Card" },
  { date: "2018-10-30", name: "There's More in the Making", kind: "october", headline: "MacBook Air / iPad Pro" },
  { date: "2018-09-12", name: "Gather Round", kind: "september", headline: "iPhone XS / XR" },
  { date: "2018-06-04", name: "WWDC 2018 Keynote", kind: "wwdc", headline: "iOS 12 / macOS Mojave" },
  { date: "2018-03-27", name: "Let's Take a Field Trip", kind: "spring", headline: "iPad (6th gen)" },
  { date: "2017-09-12", name: "Let's Meet at Our Place", kind: "september", headline: "iPhone X / iPhone 8" },
  { date: "2017-06-05", name: "WWDC 2017 Keynote", kind: "wwdc", headline: "HomePod / iMac Pro" },
  { date: "2016-10-27", name: "hello again", kind: "october", headline: "MacBook Pro Touch Bar" },
  { date: "2016-09-07", name: "See you on the 7th", kind: "september", headline: "iPhone 7 / AirPods" },
  { date: "2016-06-13", name: "WWDC 2016 Keynote", kind: "wwdc", headline: "iOS 10 / macOS Sierra" },
  { date: "2016-03-21", name: "Let us loop you in", kind: "spring", headline: "iPhone SE / 9.7\" iPad Pro" },
  { date: "2015-09-09", name: "Hey Siri, give us a hint", kind: "september", headline: "iPhone 6s / iPad Pro" },
  { date: "2015-06-08", name: "WWDC 2015 Keynote", kind: "wwdc", headline: "Apple Music / iOS 9" },
  { date: "2015-03-09", name: "Spring Forward", kind: "spring", headline: "Apple Watch / 12\" MacBook" },
  { date: "2014-10-16", name: "It's been way too long", kind: "october", headline: "iPad Air 2 / 5K iMac" },
  { date: "2014-09-09", name: "Wish we could say more", kind: "september", headline: "iPhone 6 / Watch / Pay" },
  { date: "2014-06-02", name: "WWDC 2014 Keynote", kind: "wwdc", headline: "Swift / iOS 8" },
  { date: "2013-10-22", name: "We still have a lot to cover", kind: "october", headline: "iPad Air / Mac Pro" },
  { date: "2013-09-10", name: "This should brighten everyone's day", kind: "september", headline: "iPhone 5s / 5c" },
  { date: "2013-06-10", name: "WWDC 2013 Keynote", kind: "wwdc", headline: "iOS 7 / new Mac Pro" },
  { date: "2012-10-23", name: "We've got a little more to show you", kind: "october", headline: "iPad mini" },
  { date: "2012-09-12", name: "It's almost here", kind: "september", headline: "iPhone 5" },
  { date: "2012-06-11", name: "WWDC 2012 Keynote", kind: "wwdc", headline: "Retina MacBook Pro / iOS 6" },
  { date: "2012-03-07", name: "Something you really have to see", kind: "spring", headline: "iPad (3rd gen) Retina" },
  { date: "2012-01-19", name: "Education Event", kind: "other", headline: "iBooks 2 / iTunes U" },
  { date: "2011-10-04", name: "Let's Talk iPhone", kind: "september", headline: "iPhone 4S / Siri" },
  { date: "2011-06-06", name: "WWDC 2011 Keynote", kind: "wwdc", headline: "iCloud / iOS 5" },
  { date: "2011-03-02", name: "iPad 2 Event", kind: "spring", headline: "iPad 2" },
  { date: "2010-10-20", name: "Back to the Mac", kind: "october", headline: "MacBook Air / Lion preview" },
  { date: "2010-09-01", name: "September Music Event", kind: "september", headline: "iPod touch 4 / Apple TV" },
  { date: "2010-06-07", name: "WWDC 2010 Keynote", kind: "wwdc", headline: "iPhone 4 / FaceTime" },
  { date: "2010-04-08", name: "iPhone OS 4 Preview", kind: "spring", headline: "iPhone OS 4 multitasking" },
  { date: "2010-01-27", name: "Come see our latest creation", kind: "other", headline: "iPad (1st gen)" },
  { date: "2009-09-09", name: "It's only rock and roll", kind: "september", headline: "iPod nano / iTunes 9" },
  { date: "2009-06-08", name: "WWDC 2009 Keynote", kind: "wwdc", headline: "iPhone 3GS / Snow Leopard" },
  { date: "2009-03-17", name: "iPhone OS 3.0 Preview", kind: "spring", headline: "iPhone OS 3.0" },
  { date: "2009-01-06", name: "Macworld 2009 Keynote", kind: "other", headline: "17\" MacBook Pro / DRM-free" },
  { date: "2008-10-14", name: "The spotlight turns to notebooks", kind: "october", headline: "Unibody MacBook" },
  { date: "2008-09-09", name: "Let's Rock", kind: "september", headline: "iPod nano 4G / iTunes 8" },
  { date: "2008-06-09", name: "WWDC 2008 Keynote", kind: "wwdc", headline: "iPhone 3G / App Store" },
  { date: "2008-03-06", name: "iPhone Software Roadmap", kind: "spring", headline: "iPhone SDK" },
  { date: "2008-01-15", name: "Macworld 2008 Keynote", kind: "other", headline: "MacBook Air" },
  { date: "2007-09-05", name: "The Beat Goes On", kind: "september", headline: "iPod touch / iPod classic" },
  { date: "2007-08-07", name: "Apple Special Event", kind: "other", headline: "Aluminum iMac / iLife '08" },
  { date: "2007-06-11", name: "WWDC 2007 Keynote", kind: "wwdc", headline: "Mac OS X Leopard" },
  { date: "2007-01-09", name: "Macworld 2007 Keynote", kind: "other", headline: "iPhone / Apple TV" },
];

// ── Earnings universe ───────────────────────────────────────────────────────
//
// The names the earnings study covers. Deliberately SHORT: every ticker here
// costs the server one Yahoo earnings-calendar query plus one price history
// fetch, and the point of the study is the handful of names whose prints move
// the index, not breadth.
//
// It is NOT lib/scannerTickers.ts. That list is the scanner's sweep universe
// (169 symbols including indices and ETFs, which do not report earnings) and
// pointing this at it would turn one cached response into 130 upstream calls.

export const EARNINGS_TICKERS: string[] = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD",
  "AVGO", "NFLX", "MU", "PLTR", "COIN", "SMCI", "HOOD", "MSTR",
];
