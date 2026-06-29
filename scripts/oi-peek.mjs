#!/usr/bin/env node
// Peek at live CBOE SPX/SPXW rows so you can pick a real contract.
//   node scripts/oi-peek.mjs            -> nearest expiries + sample strikes
//   node scripts/oi-peek.mjs 250703     -> rows for that expiry only
const [, , WANT_EXP] = process.argv;
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.cboe.com', Referer: 'https://www.cboe.com/',
};
const r = await fetch('https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json', { headers: H });
const rows = (await r.json())?.data?.options || [];
// option = SPXW250703P05000000 -> capture body(SPX/SPXW) exp type strike
const re = /^(SPXW?|SPX)(\d{6})([CP])(\d{8})$/;
const exps = new Map();
for (const o of rows) {
  const m = re.exec(o.option || '');
  if (!m) continue;
  const exp = m[2];
  if (WANT_EXP && exp !== WANT_EXP) continue;
  if (!exps.has(exp)) exps.set(exp, []);
  exps.get(exp).push({ body: m[1], type: m[3], strike: Number(m[4]) / 1000, oi: o.open_interest, vol: o.volume });
}
const sorted = [...exps.keys()].sort();
if (!WANT_EXP) {
  console.log('Nearest expiries (YYMMDD):', sorted.slice(0, 8).join(', '), '\n');
  const e = sorted[0];
  console.log(`Sample rows for ${e} (puts, OI>0):`);
  exps.get(e).filter((x) => x.type === 'P' && x.oi > 0).sort((a, b) => b.oi - a.oi).slice(0, 8)
    .forEach((x) => console.log(`  ${x.body} P ${x.strike}  OI=${x.oi}  vol=${x.vol}`));
} else {
  console.log(`Rows for ${WANT_EXP} (OI>0, top by OI):`);
  exps.get(WANT_EXP)?.filter((x) => x.oi > 0).sort((a, b) => b.oi - a.oi).slice(0, 15)
    .forEach((x) => console.log(`  ${x.body} ${x.type} ${x.strike}  OI=${x.oi}  vol=${x.vol}`));
}
