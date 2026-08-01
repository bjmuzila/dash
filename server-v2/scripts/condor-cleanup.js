// Remove orphaned condors: seeded but never credited AND never marked.
// DRY RUN by default. Pass --apply to actually delete.
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');
const WEEK = (process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || null);

const WHERE = `
  from em_condors c
  where c.net_credit is null and c.put_credit is null and c.call_credit is null
    and c.result is null
    and not exists (select 1 from em_condor_marks m where m.condor_id = c.id)
    ${WEEK ? 'and c.week_start = $1' : ''}`;
const ARGS = WEEK ? [WEEK] : [];

(async () => {
  const preview = await p.query(
    `select c.week_start, count(*) n ${WHERE} group by 1 order by 1 desc`, ARGS);
  if (!preview.rows.length) { console.log('nothing matches — no orphans'); await p.end(); return; }
  console.log(APPLY ? '=== DELETING ===' : '=== DRY RUN (pass --apply to delete) ===');
  let total = 0;
  for (const r of preview.rows) {
    console.log('  ', String(r.week_start).slice(0, 10), '->', r.n, 'orphan condor(s)');
    total += Number(r.n);
  }
  const tk = await p.query(
    `select count(*) n from em_condor_ticks t
      where t.condor_id in (select c.id ${WHERE})`, ARGS);
  console.log(`  + ${tk.rows[0].n} associated tick row(s)`);
  console.log('  TOTAL condors:', total);

  if (!APPLY) { console.log('\nno changes made'); await p.end(); return; }
  const cl = await p.connect();
  try {
    await cl.query('begin');
    const d1 = await cl.query(
      `delete from em_condor_ticks where condor_id in (select c.id ${WHERE})`, ARGS);
    const d2 = await cl.query(`delete ${WHERE}`, ARGS);
    await cl.query('commit');
    console.log(`\ndeleted ${d2.rowCount} condor(s), ${d1.rowCount} tick(s)`);
  } catch (e) {
    await cl.query('rollback');
    console.error('ROLLED BACK —', e.message);
    process.exitCode = 1;
  } finally { cl.release(); await p.end(); }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
