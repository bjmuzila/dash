// Settle weekly condors for a given week. Reads the realized close from the
// em_tracker rows the Saturday EM grader writes, so run it AFTER that.
// Usage: node /app/condor-settle.js 2026-07-27      (omit arg = all unsettled)
const port = process.env.PORT || 3001;
const tok = process.env.INTERNAL_API_TOKEN;
const week = process.argv[2] || null;
fetch(`http://127.0.0.1:${port}/api/em-condors/evaluate`, {
  method: 'POST',
  // The /api/* middleware gate 307s unauthenticated calls to "/"; following that
  // silently returns the landing page as a 200. Fail loudly instead.
  redirect: 'manual',
  headers: { 'content-type': 'application/json', ...(tok ? { 'x-internal-token': tok } : {}) },
  body: JSON.stringify(week ? { week_start: week } : {}),
})
  .then(async (r) => { console.log('HTTP', r.status); console.log(await r.text()); })
  .catch((e) => { console.error('ERR', e.message); process.exit(1); });
