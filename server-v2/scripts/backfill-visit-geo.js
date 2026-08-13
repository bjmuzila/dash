#!/usr/bin/env node
'use strict';
/**
 * server-v2/scripts/backfill-visit-geo.js
 *
 *   docker compose exec -T dashboard node server-v2/scripts/backfill-visit-geo.js --dry
 *   docker compose exec -T dashboard node server-v2/scripts/backfill-visit-geo.js
 *   ... --limit 20     only geocode the 20 busiest unresolved places (a taste test)
 *   ... --no-repair    skip the mojibake pass, only geocode
 *
 * Puts the visitor map's history back on the map, by CITY.
 *
 * Two separate repairs, both on `page_visits`, both idempotent:
 *
 * 1. ENCODING. Cloudflare sends `cf-ipcity: Bogotá` as UTF-8 bytes, and Node
 *    hands raw header bytes back as latin1 — so what got stored was `BogotÃ¡`.
 *    Every non-ASCII city and region in the table is mangled that way. This
 *    re-decodes them (latin1 AND cp1252, because both manglings are in there)
 *    and writes back the real name. api-router.js now does the same decode at
 *    write time, so this only ever has to fix the backlog.
 *
 * 2. COORDINATES. `latitude`/`longitude` were dropped on the way into the
 *    database until 2026-08-13 (a key-name mismatch — see the changelog), so
 *    ~6,000 rows carry a city and a country but no position, and the map could
 *    only fan them out around their country's centre. The city was there the
 *    whole time. This geocodes each DISTINCT (city, region, country) once via
 *    Open-Meteo's geocoding API and writes the coordinate onto every row that
 *    shares it. ~145 distinct places for 6,000 rows, so it is ~145 requests.
 *
 * Only ever touches rows where `latitude IS NULL` — a row that already has a
 * real Cloudflare coordinate is never overwritten with a geocoded guess.
 * Re-running is safe and cheap: the second run finds nothing to do.
 *
 * Anything that will not geocode (Cloudflare's odder metro names, rows with no
 * city at all) is left NULL and keeps the map's dashed country-level dot. The
 * unresolved list is printed at the end — that IS the report.
 */

const libDb = require('../_lib-db.cjs');

const DRY = process.argv.includes('--dry');
const NO_REPAIR = process.argv.includes('--no-repair');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Infinity;
})();

// ── Encoding repair ──────────────────────────────────────────────────────────

// windows-1252's printable slots at 0x80–0x9F, which is where the second flavour
// of mangling comes from: the byte 0x9B round-tripped through cp1252 arrives as
// U+203A, not U+009B, so a plain latin1 re-decode fails on exactly the strings
// that need it most (Polish, Czech, Turkish city names).
const CP1252_TO_BYTE = new Map(Object.entries({
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A,
  '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C,
  'ž': 0x9E, 'Ÿ': 0x9F,
}));

/** Undo one round of "UTF-8 bytes read as a single-byte encoding". Returns the
 *  input unchanged when it is plain ASCII, or when the bytes are not valid
 *  UTF-8 — i.e. when the string was never mangled and a "repair" would corrupt
 *  a name that was already correct. */
function undoMojibake(s) {
  if (typeof s !== 'string' || !s) return s;
  if (!/[^\x00-\x7F]/.test(s)) return s; // pure ASCII, nothing to undo
  const bytes = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xFF) { bytes.push(cp); continue; }
    const b = CP1252_TO_BYTE.get(ch);
    if (b === undefined) return s;       // a character no mangling produces
    bytes.push(b);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return s;                            // wasn't UTF-8 — leave it alone
  }
}

// ── Geocoding ────────────────────────────────────────────────────────────────

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const PAUSE_MS = 180;                    // ~5.5 req/s — polite on a free API

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cloudflare's region names carry suffixes Open-Meteo's admin1 does not
 *  ("Mecca Region", "Bogota D.C."), so region is a TIEBREAK between candidates
 *  in the right country, never a filter. Filtering on it would drop the correct
 *  hit and leave the place unresolved. */
function scoreCandidate(c, city, region) {
  let score = 0;
  const name = String(c.name || '').toLowerCase();
  const a1 = String(c.admin1 || '').toLowerCase();
  const wantRegion = String(region || '').toLowerCase().replace(/\s+(region|province|d\.c\.)$/, '').trim();
  if (name === city.toLowerCase()) score += 100;
  if (wantRegion && a1) {
    // PREFIX, not substring. `includes` matched "Virginia" inside "West
    // Virginia" and sent Washington, VA to Washington, WV. The real mismatch
    // between the two vocabularies is always a SUFFIX Open-Meteo adds
    // ("Île-de-France Region", "Beijing Municipality", "Brittany Region"), so a
    // prefix test keeps every one of those and drops the false positive.
    if (a1.startsWith(wantRegion) || wantRegion.startsWith(a1)) score += 60;
    // And an outright disagreement is evidence AGAINST this candidate, not
    // merely the absence of evidence for it — otherwise a bigger town in the
    // wrong state wins on population alone. A penalty only reorders candidates;
    // the best-scoring one is still taken even if every score goes negative.
    else score -= 40;
  }
  // Population is the tiebreak of last resort: between two same-named towns in
  // the right country, the one people actually live in is the better guess.
  score += Math.min(20, Math.log10((c.population || 0) + 1) * 3);
  return score;
}

async function geocode(city, region, country) {
  const url = `${GEO_URL}?name=${encodeURIComponent(city)}&count=20&language=en&format=json`;
  let data;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'cbedge-visit-geo-backfill' } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    data = await res.json();
  } catch (e) {
    return { error: String(e?.message || e) };
  }
  const all = Array.isArray(data?.results) ? data.results : [];
  if (!all.length) return { error: 'no results' };
  const inCountry = country ? all.filter((c) => c.country_code === country) : all;
  if (!inCountry.length) return { error: `no result in ${country}` };
  const best = inCountry
    .map((c) => ({ c, s: scoreCandidate(c, city, region) }))
    .sort((a, b) => b.s - a.s)[0].c;
  if (!Number.isFinite(best.latitude) || !Number.isFinite(best.longitude)) {
    return { error: 'result had no coordinate' };
  }
  return { lat: best.latitude, lon: best.longitude, matched: `${best.name}, ${best.admin1 || '?'}` };
}

// ── Run ──────────────────────────────────────────────────────────────────────

(async () => {
  const pool = await libDb.getDb();
  const label = DRY ? '[dry] ' : '';

  // 1. Encoding ──────────────────────────────────────────────────────────────
  if (!NO_REPAIR) {
    const { rows: mangled } = await pool.query(`
      SELECT DISTINCT city, region FROM page_visits
       WHERE city ~ '[^[:ascii:]]' OR region ~ '[^[:ascii:]]'
    `);
    let fixedCity = 0;
    let fixedRegion = 0;
    for (const r of mangled) {
      const city = undoMojibake(r.city);
      const region = undoMojibake(r.region);
      if (city === r.city && region === r.region) continue;
      console.log(`${label}encoding  ${JSON.stringify(r.city)}/${JSON.stringify(r.region)} → ${JSON.stringify(city)}/${JSON.stringify(region)}`);
      if (DRY) continue;
      // IS NOT DISTINCT FROM, not =, so the NULL region rows match too.
      const res = await pool.query(
        `UPDATE page_visits SET city = $1, region = $2
          WHERE city IS NOT DISTINCT FROM $3 AND region IS NOT DISTINCT FROM $4`,
        [city, region, r.city, r.region]
      );
      if (city !== r.city) fixedCity += res.rowCount;
      if (region !== r.region) fixedRegion += res.rowCount;
    }
    console.log(`${label}encoding: ${mangled.length} distinct place(s) inspected, ${fixedCity} row(s) re-decoded`);
    if (fixedRegion) console.log(`${label}encoding: ${fixedRegion} row(s) had their region re-decoded`);
  }

  // 2. Coordinates ───────────────────────────────────────────────────────────
  const { rows: places } = await pool.query(`
    SELECT city, region, country, COUNT(*)::int AS rows
      FROM page_visits
     WHERE latitude IS NULL
       AND city IS NOT NULL AND city <> ''
       AND country IS NOT NULL AND country NOT IN ('XX', 'T1')
     GROUP BY city, region, country
     ORDER BY COUNT(*) DESC
  `);

  if (!places.length) {
    console.log('Nothing to geocode — every row with a city already has a coordinate.');
    await pool.end();
    return;
  }

  const targets = places.slice(0, LIMIT === Infinity ? places.length : LIMIT);
  const skipped = places.length - targets.length;
  console.log(
    `${label}geocode: ${targets.length} distinct place(s)` +
    (skipped ? ` (${skipped} more not attempted — --limit)` : '') +
    ` covering ${targets.reduce((n, p) => n + p.rows, 0)} row(s)`
  );

  let ok = 0;
  let rowsSet = 0;
  const failed = [];

  for (const p of targets) {
    // Geocode the REPAIRED name, not the stored one. On a real run pass 1 has
    // already written it, but on a --dry run the table still holds `BogotÃ¡` —
    // and a dry run whose failure list is ten places that would actually
    // succeed is worse than no dry run at all. Decoding here makes the two
    // modes agree, and keeps --no-repair working on a table nobody has fixed.
    const city = undoMojibake(p.city);
    const region = undoMojibake(p.region);
    const shown = city === p.city ? city : `${city} (was ${p.city})`;
    const hit = await geocode(city, region, p.country);
    await sleep(PAUSE_MS);
    if (hit.error) {
      failed.push({ ...p, city, region, why: hit.error });
      console.log(`${label}  ✗ ${shown}, ${region || '—'}, ${p.country} (${p.rows} rows) — ${hit.error}`);
      continue;
    }
    ok++;
    if (DRY) {
      console.log(`${label}  ✓ ${shown}, ${region || '—'}, ${p.country} (${p.rows} rows) → ${hit.lat}, ${hit.lon}  [${hit.matched}]`);
      continue;
    }
    const res = await pool.query(
      `UPDATE page_visits SET latitude = $1, longitude = $2
        WHERE latitude IS NULL
          AND city IS NOT DISTINCT FROM $3
          AND region IS NOT DISTINCT FROM $4
          AND country IS NOT DISTINCT FROM $5`,
      [hit.lat, hit.lon, p.city, p.region, p.country]
    );
    rowsSet += res.rowCount;
    console.log(`  ✓ ${p.city}, ${p.region || '—'}, ${p.country} → ${hit.lat}, ${hit.lon}  [${hit.matched}] · ${res.rowCount} row(s)`);
  }

  console.log(`\n${label}done: ${ok}/${targets.length} place(s) resolved, ${rowsSet} row(s) given a coordinate`);
  if (failed.length) {
    // Not a failure of the run — these keep their dashed country-level dot on
    // the map, which is the honest rendering for "we know the country, not the
    // city". Printed so a name worth hand-fixing is visible rather than silent.
    console.log(`\n${failed.length} place(s) did not resolve and stay country-level:`);
    for (const f of failed) console.log(`  ${f.city}, ${f.region || '—'}, ${f.country}  (${f.rows} rows) — ${f.why}`);
  }

  const { rows: [after] } = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE latitude IS NOT NULL)::int AS located,
           COUNT(*)::int AS total
      FROM page_visits
  `);
  console.log(`\npage_visits: ${after.located}/${after.total} rows now carry a coordinate`);

  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
