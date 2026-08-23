#!/usr/bin/env node
/**
 * scripts/fetch-ticker-logos.mjs
 *
 * Mirrors company logos into public/logos/<SYM>.png so the earnings chips on
 * /app/home load them same-origin and immutably cached.
 *
 * WHY
 * ---
 * EconCalendarPanel used to point every chip at /proxy/ticker-logo, which on a
 * cold in-process cache does: PG SELECT → HEAD raw.githubusercontent.com → up
 * to two sequential Wikidata calls → PG INSERT, and THEN 302s the browser to a
 * third-party host it has no warm connection to. That is two full round trips
 * per logo. On the home waterfall the seven chips cost ~1.4s for each 302 plus
 * ~0.8s for each redirected PNG — about 2.4s of tail, on the DEFAULT tab, on
 * every single page load. Mirrored files turn that into seven same-origin
 * requests that are HTTP/2-multiplexed and served from disk cache thereafter.
 *
 * The panel still falls back to /proxy/ticker-logo when a file is missing, so
 * running this is an optimisation, never a prerequisite. Re-run it whenever new
 * names start showing up in the earnings week (it is incremental — existing
 * files are skipped unless --force).
 *
 * USAGE
 *   node scripts/fetch-ticker-logos.mjs                    # seed list + PG cache
 *   node scripts/fetch-ticker-logos.mjs --from-earnings    # + this week's earnings
 *   node scripts/fetch-ticker-logos.mjs --force            # re-download everything
 *   node scripts/fetch-ticker-logos.mjs AAPL MSFT NVDA     # just these
 *
 * Needs DATABASE_URL for the PG logo cache (optional — falls back to live
 * resolution) and, for --from-earnings, a reachable backend at
 * PROXY_URL / http://127.0.0.1:3002.
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'public', 'logos');

// Same resolver the /proxy/ticker-logo route uses — one source of truth for the
// GitHub → Wikidata order and the ticker_logos PG cache.
const { resolveLogo, ensureSchema, getPool } = require(
  path.join(REPO_ROOT, 'server-v2', 'ticker-logo.js'),
);

const UA = 'cbedge-dashboard/1.0 (logo mirror; contact bjmuzila@gmail.com)';
const CONCURRENCY = 6;

// Large caps that show up in the earnings strip often enough to be worth having
// on disk before they appear. Anything not here resolves live on first miss.
//
// The second half of this list (everything from ABNB down) was added 2026-08-23
// and every symbol in it was HEAD-verified against davidepalazzo/ticker-logos
// first — so an "unresolved" tally on one of those means the upstream repo
// dropped the file, not that the name was a guess. It covers the rest of the
// S&P 500 plus the mid-cap software / fintech / Canadian-bank names that kept
// showing up in the earnings week as ticker-TEXT chips (ZM, CRWD, VEEV, OKTA,
// WDAY, MRVL, AFRM, BMO, BNS, HPQ, WSM, TCOM, DG, ADSK, CM…).
//
// NO COMMENTS INSIDE THE TEMPLATE LITERAL: it is whitespace-split straight into
// symbols, and the filename filter in main() (`/^[A-Z0-9.\-]{1,10}$/`) happily
// accepts things like a bare date. Keep prose out here.
const SEED = `
AAPL MSFT NVDA AMZN GOOGL GOOG META TSLA AVGO BRK.B LLY JPM V UNH XOM MA
JNJ PG COST HD ABBV WMT NFLX MRK KO ADBE PEP CVX CSCO CRM AMD TMO ACN MCD
LIN ABT DHR INTC WFC TXN VZ QCOM DIS INTU CMCSA PFE AMGN NOW IBM CAT GE
UBER SPGI UNP BA PM NKE RTX HON COP AXP LOW BKNG NEO GS ISRG BLK ELV SYK
DE MDT LMT PLD TJX ADP MDLZ VRTX GILD REGN CB MMC ETN SCHW BMY ADI PGR
CI SO ZTS DUK BSX CVS MU PANW SNPS KLAC CDNS ANET MAR ORCL SHOP PYPL SQ
ASML TSM SAP NVO AZN SHEL BP TTE UL HSBC RY TD SONY TM MUFG BABA PDD JD
NEE CL EOG SLB MPC PSX VLO OXY KMI WMB HAL DVN FANG HES APA MRO
T TMUS CHTR WBD PARA FOX NWSA OMC IPG DISH LYV EA TTWO RBLX U SNAP PINS
ENB CVE SU TRP CNQ IMO ETN LIN APD SHW ECL DD DOW LYB PPG NUE FCX NEM
ABBV BIIB MRNA BNTX ILMN IQV A DXCM IDXX WST MTD ALGN PODD ZBH BAX
PLTR APP HWM WDC SNDK PBR PBR.A
ABNB ACGL ADM ADSK AEP AER AFL AFRM AIG AJG AKAM ALB ALL AMAT AMP AMT AON
APH ARM ATVI AVB AVY AWK AXON AZO BAC BAH BBY BDX BEN BG BIDU BILI BK BKR
BMO BNS BR BRO BSY BX BXP C CAH CARR CBOE CBRE CCEP CCI CCL CDW CE CEG CF
CFG CHD CHKP CHWY CINF CLX CM CMA CME CMG CMI CNC COF COIN CPB CPRT CRH CRWD
CSGP CSX CTAS CTRA CTSH CTVA CZR D DAL DASH DDOG DELL DFS DG DGX DHI DKNG
DLR DLTR DOCU DPZ DRI DTE DUOL DXC EBAY EFX EIX EL EMN EMR ENPH EPAM EQIX
EQR EQT ES ESS ETR ETSY EW EXC EXPD EXPE EXR F FAST FCNCA FDX FE FI FICO FIS
FITB FLEX FMC FSLR FTNT FTV GD GDDY GEHC GIS GL GLW GM GPC GPN GRMN HAS HEI
HIG HLT HOLX HOOD HPE HPQ HRL HST HSY HUBS HUM IEX IFF INCY INFY IP IRM ITW
IVZ J JBHT JBL JCI JNPR K KDP KEY KEYS KHC KIM KMB KMX KR KVUE L LDOS LEN LH
LKQ LNT LRCX LULU LUV LVS LW MANH MCHP MCK MCO MELI MET MGM MHK MKC MKTX MLM
MNST MO MOH MOS MRVL MS MSCI MSI MTB MTCH NCLH NDAQ NDSN NET NI NOC NRG NSC
NTAP NTES NTRS NWS NXPI O ODFL OKE OKTA OMCL ON ORLY OTIS OWL PAYX PCAR PEG
PH PHM PKG PNC PNW PPL PRU RCL REG RF RJF RL RMD ROK ROL ROST RSG SBUX SEDG
SJM SLG SMCI SNOW SOFI SPOT SRE STE STLD STT STX STZ SWK SWKS SYF SYY TAP
TCOM TDY TECH TER TFC TGT TOST TROW TSN TTD TWLO TXT UAL ULTA UPS USB VEEV
VICI VRSK VRT VST VTRS WAB WBA WDAY WM WRB WSM WYNN XYL ZM ZS
`.trim().split(/\s+/).filter(Boolean);

// Hand-mirrored logos: neither the GitHub set nor Wikidata resolves these, so
// public/logos/<SYM>.png was cropped and committed by hand. Never overwrite
// them — including under --force, which would otherwise replace a good file
// with nothing (resolveLogo returns null) or with an unusable wide lockup.
// PBR.A is Petrobras' preferred-share line and HEI.A is HEICO's class A.
// resolveLogo has nothing for a dotted class suffix (GitHub keys on the plain
// root symbol, and Wikidata searches the company, not the share class), so
// public/logos/PBR.A.png and HEI.A.png are copies of PBR.png / HEI.png. Same
// treatment as SPCX: keep them, never re-resolve them. Note that both class
// lines DO appear in the earnings feed alongside their root symbol (HEI and
// HEI.A both reported 2026-08-25), so this is not a hypothetical.
const MANUAL = new Set(['SPCX', 'PBR.A', 'HEI.A']);

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const FROM_EARNINGS = args.includes('--from-earnings');
const EXPLICIT = args.filter((a) => !a.startsWith('--')).map((s) => s.toUpperCase());

/** Symbols already resolved into the PG cache — cheap to mirror, zero lookups. */
async function symbolsFromCache() {
  try {
    if (!(await ensureSchema())) return [];
    const { rows } = await getPool().query(
      'SELECT symbol FROM ticker_logos WHERE url IS NOT NULL',
    );
    return rows.map((r) => String(r.symbol));
  } catch (e) {
    console.warn('[logos] PG cache unavailable:', e.message);
    return [];
  }
}

/** This week's earnings names, straight off the running backend. */
async function symbolsFromEarnings() {
  const base = process.env.PROXY_URL || `http://127.0.0.1:${process.env.PROXY_PORT || 3002}`;
  try {
    const r = await fetch(`${base}/proxy/earnings-week`, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const rows = Array.isArray(j?.earnings) ? j.earnings : Array.isArray(j) ? j : [];
    return rows.map((e) => String(e?.symbol || '')).filter(Boolean);
  } catch (e) {
    console.warn(`[logos] --from-earnings skipped (${e.message}) — is the backend running?`);
    return [];
  }
}

const exists = (p) => access(p).then(() => true, () => false);

async function mirror(sym) {
  const file = path.join(OUT_DIR, `${sym}.png`);
  if (MANUAL.has(sym) && (await exists(file))) return 'skip';
  if (!FORCE && (await exists(file))) return 'skip';

  const url = await resolveLogo(sym, '');
  if (!url) return 'none';

  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) return 'fail';

  const buf = Buffer.from(await res.arrayBuffer());
  // Commons can hand back an SVG render or an HTML error page; only keep real
  // raster bytes, otherwise the <img> would 200 with garbage and never fall back.
  const isPng = buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
  const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpg) return 'fail';
  if (buf.length < 200) return 'fail';

  await writeFile(file, buf);
  return 'ok';
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const wanted = EXPLICIT.length
    ? EXPLICIT
    : [
        ...SEED,
        ...(await symbolsFromCache()),
        ...(FROM_EARNINGS ? await symbolsFromEarnings() : []),
      ];

  // Dedupe, and drop anything with a character that can't be a safe filename.
  const symbols = [...new Set(wanted.map((s) => s.toUpperCase().trim()))]
    .filter((s) => /^[A-Z0-9.\-]{1,10}$/.test(s));

  console.log(`[logos] ${symbols.length} symbols → ${path.relative(REPO_ROOT, OUT_DIR)}`);

  const tally = { ok: 0, skip: 0, none: 0, fail: 0 };
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < symbols.length) {
        const sym = symbols[cursor++];
        try {
          const r = await mirror(sym);
          tally[r] += 1;
          if (r === 'ok') console.log(`  ✓ ${sym}`);
          if (r === 'fail') console.log(`  ✗ ${sym} (bad bytes)`);
        } catch (e) {
          tally.fail += 1;
          console.log(`  ✗ ${sym} (${e.message})`);
        }
      }
    }),
  );

  console.log(
    `[logos] done — ${tally.ok} written, ${tally.skip} already present, ` +
    `${tally.none} unresolved, ${tally.fail} failed`,
  );
  console.log('[logos] commit public/logos/ so the chips ship with the build.');

  try { await getPool()?.end(); } catch { /* pool may never have opened */ }
  process.exit(0);
}

main().catch((e) => {
  console.error('[logos] fatal:', e);
  process.exit(1);
});
