/**
 * Synthetic page_visits rows for the sandbox map.
 *
 * The console's map takes `VisitorMapRow[]` straight off /api/page-visits: one
 * row per PAGE LOAD, carrying the visitor's country, city, coordinate and, when
 * they were signed in, their account. This file hands it the same shape from a
 * seeded generator instead of a query, so the page it draws is the console's
 * page and only the rows are invented.
 *
 * Deliberately reproduced, because they are what the map's edge cases are made
 * of:
 *   · loads outnumber visitors, so a person with 90 loads is still one dot;
 *   · some visitors have no coordinate, only a country, and get drawn dashed
 *     around its centroid (rows that predate the coordinate columns);
 *   · a few rows have no country at all (Cloudflare's XX, or a Tor exit) and
 *     land in the Unknown bucket rather than being dropped;
 *   · paying, signed-in-not-paying and anonymous are three different dots.
 *
 * The seed is fixed, so the map is the same map on every load and a screenshot
 * of it stays true. Nothing here is a real person, email, IP or address.
 */
import type { VisitorMapRow } from "./VisitorMap";

/** [city, region, ISO 3166-1 alpha-2, lat, lon, relative weight]. */
const CITIES: [string, string, string, number, number, number][] = [
  ["New York", "New York", "US", 40.71, -74.01, 9],
  ["Brooklyn", "New York", "US", 40.68, -73.94, 4],
  ["Jersey City", "New Jersey", "US", 40.73, -74.07, 2],
  ["Philadelphia", "Pennsylvania", "US", 39.95, -75.17, 3],
  ["Boston", "Massachusetts", "US", 42.36, -71.06, 4],
  ["Cambridge", "Massachusetts", "US", 42.37, -71.11, 2],
  ["Washington", "District of Columbia", "US", 38.91, -77.04, 3],
  ["Arlington", "Virginia", "US", 38.88, -77.10, 2],
  ["Richmond", "Virginia", "US", 37.54, -77.44, 2],
  ["Charlotte", "North Carolina", "US", 35.23, -80.84, 3],
  ["Raleigh", "North Carolina", "US", 35.78, -78.64, 2],
  ["Atlanta", "Georgia", "US", 33.75, -84.39, 4],
  ["Orlando", "Florida", "US", 28.54, -81.38, 3],
  ["Tampa", "Florida", "US", 27.95, -82.46, 3],
  ["Miami", "Florida", "US", 25.76, -80.19, 4],
  ["Fort Lauderdale", "Florida", "US", 26.12, -80.14, 2],
  ["Jacksonville", "Florida", "US", 30.33, -81.66, 2],
  ["Nashville", "Tennessee", "US", 36.16, -86.78, 3],
  ["Memphis", "Tennessee", "US", 35.15, -90.05, 1],
  ["Louisville", "Kentucky", "US", 38.25, -85.76, 1],
  ["Columbus", "Ohio", "US", 39.96, -83.00, 2],
  ["Cleveland", "Ohio", "US", 41.50, -81.69, 2],
  ["Detroit", "Michigan", "US", 42.33, -83.05, 2],
  ["Chicago", "Illinois", "US", 41.88, -87.63, 6],
  ["Naperville", "Illinois", "US", 41.79, -88.15, 2],
  ["Milwaukee", "Wisconsin", "US", 43.04, -87.91, 1],
  ["Minneapolis", "Minnesota", "US", 44.98, -93.27, 3],
  ["Des Moines", "Iowa", "US", 41.59, -93.62, 1],
  ["Kansas City", "Missouri", "US", 39.10, -94.58, 2],
  ["St. Louis", "Missouri", "US", 38.63, -90.20, 2],
  ["Omaha", "Nebraska", "US", 41.26, -95.94, 1],
  ["Oklahoma City", "Oklahoma", "US", 35.47, -97.52, 1],
  ["Dallas", "Texas", "US", 32.78, -96.80, 4],
  ["Fort Worth", "Texas", "US", 32.76, -97.33, 2],
  ["Houston", "Texas", "US", 29.76, -95.37, 4],
  ["Austin", "Texas", "US", 30.27, -97.74, 4],
  ["San Antonio", "Texas", "US", 29.42, -98.49, 2],
  ["Denver", "Colorado", "US", 39.74, -104.99, 3],
  ["Colorado Springs", "Colorado", "US", 38.83, -104.82, 1],
  ["Salt Lake City", "Utah", "US", 40.76, -111.89, 2],
  ["Phoenix", "Arizona", "US", 33.45, -112.07, 3],
  ["Tucson", "Arizona", "US", 32.22, -110.97, 1],
  ["Las Vegas", "Nevada", "US", 36.17, -115.14, 2],
  ["Albuquerque", "New Mexico", "US", 35.08, -106.65, 1],
  ["Los Angeles", "California", "US", 34.05, -118.24, 6],
  ["San Diego", "California", "US", 32.72, -117.16, 3],
  ["Irvine", "California", "US", 33.68, -117.83, 2],
  ["San Jose", "California", "US", 37.34, -121.89, 2],
  ["San Francisco", "California", "US", 37.77, -122.42, 4],
  ["Oakland", "California", "US", 37.80, -122.27, 1],
  ["Sacramento", "California", "US", 38.58, -121.49, 1],
  ["Portland", "Oregon", "US", 45.52, -122.68, 2],
  ["Seattle", "Washington", "US", 47.61, -122.33, 3],
  ["Bellevue", "Washington", "US", 47.61, -122.20, 1],
  ["Boise", "Idaho", "US", 43.62, -116.20, 1],
  ["Anchorage", "Alaska", "US", 61.22, -149.90, 1],
  ["Honolulu", "Hawaii", "US", 21.31, -157.86, 1],
  ["Toronto", "Ontario", "CA", 43.65, -79.38, 4],
  ["Montreal", "Quebec", "CA", 45.50, -73.57, 2],
  ["Vancouver", "British Columbia", "CA", 49.28, -123.12, 3],
  ["Calgary", "Alberta", "CA", 51.05, -114.07, 2],
  ["Ottawa", "Ontario", "CA", 45.42, -75.70, 1],
  ["Mexico City", "Mexico", "MX", 19.43, -99.13, 2],
  ["Guadalajara", "Mexico", "MX", 20.67, -103.35, 1],
  ["Monterrey", "Mexico", "MX", 25.69, -100.32, 1],
  ["Sao Paulo", "Brazil", "BR", -23.55, -46.63, 3],
  ["Rio de Janeiro", "Brazil", "BR", -22.91, -43.17, 2],
  ["Brasilia", "Brazil", "BR", -15.79, -47.88, 1],
  ["Porto Alegre", "Brazil", "BR", -30.03, -51.23, 1],
  ["Buenos Aires", "Argentina", "AR", -34.60, -58.38, 2],
  ["Cordoba", "Argentina", "AR", -31.42, -64.18, 1],
  ["Santiago", "Chile", "CL", -33.45, -70.67, 1],
  ["Bogota", "Colombia", "CO", 4.71, -74.07, 1],
  ["Medellin", "Colombia", "CO", 6.24, -75.58, 1],
  ["Lima", "Peru", "PE", -12.05, -77.04, 1],
  ["Panama City", "Panama", "PA", 8.98, -79.52, 1],
  ["London", "United Kingdom", "GB", 51.51, -0.13, 6],
  ["Manchester", "United Kingdom", "GB", 53.48, -2.24, 2],
  ["Edinburgh", "United Kingdom", "GB", 55.95, -3.19, 1],
  ["Birmingham", "United Kingdom", "GB", 52.49, -1.89, 1],
  ["Bristol", "United Kingdom", "GB", 51.45, -2.59, 1],
  ["Dublin", "Ireland", "IE", 53.35, -6.26, 2],
  ["Paris", "France", "FR", 48.86, 2.35, 3],
  ["Lyon", "France", "FR", 45.76, 4.84, 1],
  ["Marseille", "France", "FR", 43.30, 5.37, 1],
  ["Berlin", "Germany", "DE", 52.52, 13.40, 3],
  ["Munich", "Germany", "DE", 48.14, 11.58, 2],
  ["Frankfurt", "Germany", "DE", 50.11, 8.68, 2],
  ["Hamburg", "Germany", "DE", 53.55, 9.99, 1],
  ["Amsterdam", "Netherlands", "NL", 52.37, 4.90, 2],
  ["Rotterdam", "Netherlands", "NL", 51.92, 4.48, 1],
  ["Brussels", "Belgium", "BE", 50.85, 4.35, 1],
  ["Zurich", "Switzerland", "CH", 47.38, 8.54, 2],
  ["Geneva", "Switzerland", "CH", 46.20, 6.14, 1],
  ["Vienna", "Austria", "AT", 48.21, 16.37, 1],
  ["Madrid", "Spain", "ES", 40.42, -3.70, 2],
  ["Barcelona", "Spain", "ES", 41.39, 2.17, 2],
  ["Valencia", "Spain", "ES", 39.47, -0.38, 1],
  ["Lisbon", "Portugal", "PT", 38.72, -9.14, 1],
  ["Porto", "Portugal", "PT", 41.15, -8.61, 1],
  ["Milan", "Italy", "IT", 45.46, 9.19, 2],
  ["Rome", "Italy", "IT", 41.90, 12.50, 1],
  ["Stockholm", "Sweden", "SE", 59.33, 18.07, 1],
  ["Oslo", "Norway", "NO", 59.91, 10.75, 1],
  ["Copenhagen", "Denmark", "DK", 55.68, 12.57, 1],
  ["Helsinki", "Finland", "FI", 60.17, 24.94, 1],
  ["Warsaw", "Poland", "PL", 52.23, 21.01, 2],
  ["Krakow", "Poland", "PL", 50.06, 19.94, 1],
  ["Prague", "Czechia", "CZ", 50.08, 14.44, 1],
  ["Budapest", "Hungary", "HU", 47.50, 19.04, 1],
  ["Bucharest", "Romania", "RO", 44.43, 26.10, 1],
  ["Athens", "Greece", "GR", 37.98, 23.73, 1],
  ["Istanbul", "Turkey", "TR", 41.01, 28.98, 2],
  ["Ankara", "Turkey", "TR", 39.93, 32.86, 1],
  ["Kyiv", "Ukraine", "UA", 50.45, 30.52, 1],
  ["Moscow", "Russia", "RU", 55.76, 37.62, 1],
  ["Saint Petersburg", "Russia", "RU", 59.94, 30.31, 1],
  ["Dubai", "United Arab Emirates", "AE", 25.20, 55.27, 3],
  ["Abu Dhabi", "United Arab Emirates", "AE", 24.45, 54.38, 1],
  ["Riyadh", "Saudi Arabia", "SA", 24.71, 46.68, 2],
  ["Jeddah", "Saudi Arabia", "SA", 21.49, 39.19, 1],
  ["Tel Aviv", "Israel", "IL", 32.09, 34.78, 2],
  ["Doha", "Qatar", "QA", 25.29, 51.53, 1],
  ["Kuwait City", "Kuwait", "KW", 29.38, 47.99, 1],
  ["Amman", "Jordan", "JO", 31.95, 35.93, 1],
  ["Mumbai", "India", "IN", 19.08, 72.88, 3],
  ["Bengaluru", "India", "IN", 12.97, 77.59, 3],
  ["Delhi", "India", "IN", 28.61, 77.21, 2],
  ["Hyderabad", "India", "IN", 17.39, 78.49, 2],
  ["Chennai", "India", "IN", 13.08, 80.27, 1],
  ["Pune", "India", "IN", 18.52, 73.86, 1],
  ["Karachi", "Pakistan", "PK", 24.86, 67.01, 1],
  ["Lahore", "Pakistan", "PK", 31.55, 74.34, 1],
  ["Dhaka", "Bangladesh", "BD", 23.81, 90.41, 1],
  ["Colombo", "Sri Lanka", "LK", 6.93, 79.86, 1],
  ["Singapore", "Singapore", "SG", 1.35, 103.82, 3],
  ["Kuala Lumpur", "Malaysia", "MY", 3.14, 101.69, 1],
  ["Bangkok", "Thailand", "TH", 13.76, 100.50, 2],
  ["Ho Chi Minh City", "Vietnam", "VN", 10.82, 106.63, 1],
  ["Hanoi", "Vietnam", "VN", 21.03, 105.85, 1],
  ["Jakarta", "Indonesia", "ID", -6.21, 106.85, 2],
  ["Manila", "Philippines", "PH", 14.60, 120.98, 2],
  ["Cebu", "Philippines", "PH", 10.32, 123.89, 1],
  ["Shanghai", "China", "CN", 31.23, 121.47, 1],
  ["Beijing", "China", "CN", 39.90, 116.41, 1],
  ["Shenzhen", "China", "CN", 22.54, 114.06, 1],
  ["Hong Kong", "Hong Kong", "HK", 22.32, 114.17, 2],
  ["Taipei", "Taiwan", "TW", 25.03, 121.57, 1],
  ["Tokyo", "Japan", "JP", 35.68, 139.69, 2],
  ["Osaka", "Japan", "JP", 34.69, 135.50, 1],
  ["Seoul", "South Korea", "KR", 37.57, 126.98, 2],
  ["Sydney", "Australia", "AU", -33.87, 151.21, 3],
  ["Melbourne", "Australia", "AU", -37.81, 144.96, 2],
  ["Brisbane", "Australia", "AU", -27.47, 153.03, 1],
  ["Perth", "Australia", "AU", -31.95, 115.86, 1],
  ["Auckland", "New Zealand", "NZ", -36.85, 174.76, 1],
  ["Wellington", "New Zealand", "NZ", -41.29, 174.78, 1],
  ["Johannesburg", "South Africa", "ZA", -26.20, 28.05, 2],
  ["Cape Town", "South Africa", "ZA", -33.92, 18.42, 1],
  ["Lagos", "Nigeria", "NG", 6.52, 3.38, 1],
  ["Nairobi", "Kenya", "KE", -1.29, 36.82, 1],
  ["Cairo", "Egypt", "EG", 30.04, 31.24, 1],
  ["Casablanca", "Morocco", "MA", 33.57, -7.59, 1],
  ["Accra", "Ghana", "GH", 5.60, -0.19, 1],];

/** The app's routes, the way page_visits records them. */
const PAGES: [string, string, string][] = [
  ["home", "Home", "/home"],
  ["gex-candles", "GEX Candles", "/gex-candles"],
  ["es-candles", "ES Candles", "/es-candles"],
  ["mult-greek", "Multi Greek", "/mult-greek"],
  ["options-chain", "Options Chain", "/options-chain"],
  ["est-moves", "Est. Moves", "/est-moves"],
  ["scanner", "Scanner", "/scanner"],
  ["account", "Account", "/account"],
  ["pricing", "Pricing", "/pricing"],
  ["landing", "Landing", "/"],
];

const FIRST = ["Dan","Marisol","Sarah","Owen","Priya","Tomas","Nina","Ravi","Elena","Marcus","Yuki","Jonas","Ana","Karl","Leah","Diego","Hana","Ben","Ines","Pavel","Grace","Ahmed","Clara","Sam","Ilya","Maya","Felix","Rosa","Kwame","Mei","Lucas","Anja","Theo","Zara","Victor","Noor","Hugo","Iris","Omar","Rita"];
const LAST = ["Hoffman","Torres","Whitfield","Keller","Nair","Ruiz","Lindqvist","Mehta","Vargas","Doyle","Tanaka","Berg","Silva","Weber","Novak","Okafor","Petrov","Costa","Fischer","Larsen","Haddad","Moreau","Bauer","Ellis","Sorensen","Kim","Rossi","Dumont","Abadi","Chen","Walsh","Reyes","Fontaine","Hale","Marek","Osei"];
const MAIL = ["gmail.com","outlook.com","proton.me","yahoo.com","icloud.com","fastmail.com"];
const PAID = ["active", "active", "active", "trialing"];
const LAPSED = ["past_due", "canceled"];

/** mulberry32. One line, deterministic, and it does not need a dependency. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;

/** Whole history depth, in days. The range picker never reaches past this. */
const HISTORY_DAYS = 196;

function build(): VisitorMapRow[] {
  const r = rng(20260916);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

  // Anchored to the top of the current hour rather than to `now`, so the newest
  // row does not move between two renders of the same page.
  const now = Math.floor(Date.now() / 3600000) * 3600000;
  const rows: VisitorMapRow[] = [];

  for (const [city, region, cc, lat, lon, weight] of CITIES) {
    const people = Math.max(1, Math.round(weight * (0.7 + r() * 0.9)));
    for (let p = 0; p < people; p++) {
      const roll = r();
      const paying = roll < 0.045;
      const member = !paying && roll < 0.13;

      let email: string | null = null;
      let userId: string | null = null;
      let userName: string | null = null;
      let userCreatedAt: string | null = null;
      let userLastLoginAt: string | null = null;
      if (paying || member) {
        const fn = pick(FIRST);
        const ln = pick(LAST);
        email = `${fn[0].toLowerCase()}.${ln.toLowerCase()}${int(1, 89)}@${pick(MAIL)}`;
        userId = `u_${Math.floor(r() * 0xffffff).toString(16).padStart(6, "0")}`;
        if (r() < 0.55) userName = `${ln.toLowerCase()}${int(2, 99)}`;
        userCreatedAt = new Date(now - int(20, HISTORY_DAYS) * DAY).toISOString();
      }

      // A visitor is active across a window, not at a point: first seen a while
      // back, last seen somewhere between then and today.
      const first = int(0, HISTORY_DAYS);
      const last = Math.floor(first * r() * 0.9);
      const loads = paying ? int(20, 160) : member ? int(5, 40) : int(1, 12);
      if (paying || member) {
        userLastLoginAt = new Date(now - last * DAY - int(0, 20) * 3600000).toISOString();
      }

      // Rows that predate the coordinate columns: a country, and nothing finer.
      const coordless = r() < 0.12;
      // Cloudflare could not place the IP at all (XX), or it is a Tor exit (T1).
      const unplaceable = r() < 0.018;

      const ip = `${int(12, 217)}.${int(1, 250)}.${int(0, 255)}.${int(1, 254)}`;

      for (let i = 0; i < loads; i++) {
        const day = last + Math.floor((first - last) * r() * r());
        const at = now - day * DAY - int(0, 23) * 3600000 - int(0, 59) * 60000;
        const [pageKey, label, path] = pick(PAGES);
        void pageKey;
        rows.push({
          country: unplaceable ? pick(["XX", "T1"]) : cc,
          region: coordless || unplaceable ? null : region,
          city: coordless || unplaceable ? null : city,
          lat: coordless || unplaceable ? null : lat,
          lon: coordless || unplaceable ? null : lon,
          ip,
          path,
          pageLabel: label,
          createdAt: new Date(at).toISOString(),
          userId,
          userEmail: email,
          userName,
          userCreatedAt,
          userLastLoginAt,
          isSubscriber: paying,
          subStatus: paying ? pick(PAID) : member && r() < 0.25 ? pick(LAPSED) : null,
          isOwner: false,
        });
      }
    }
  }

  // The API hands back newest first, and the detail cards show "recent visits"
  // in that order, so sort here rather than leaving it to chance.
  rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return rows;
}

/** Every synthetic load, newest first. */
export const SAMPLE_VISITS: VisitorMapRow[] = build();

/** The rows inside a window, the way the server's `days` parameter cuts them. */
export function visitsWithin(days: number): VisitorMapRow[] {
  if (!days) return SAMPLE_VISITS;
  const floor = Date.now() - days * DAY;
  return SAMPLE_VISITS.filter((v) => Date.parse(v.createdAt ?? "") >= floor);
}
