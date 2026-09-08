import { chromium } from 'playwright';
const KEYS = ["Hub","Admin","Visitors","ControlPanel","Sales","Feedback","SocialMedia","PostStudio",
  "Changelog","Affiliates","Emails","MediaDump","BzilaAlerts","Results","Backtests","Probe","Greeks",
  "GexGrowth","DailyGrades","EstimatedMove","Watchlists","ChartsUI","LseData","Dev","Database",
  "Budget","Reta","Todo"];
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1440,height:960} });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if(m.type()==='error') errs.push('CONSOLE: ' + m.text()); });
await p.goto('file:///home/claude/demo/dist/index.html');
for (const k of KEYS){
  await p.evaluate(kk => go(kk), k);
  await p.waitForTimeout(30);
  const n = await p.evaluate(() => document.querySelector('#view .page')?.innerHTML.length || 0);
  const t = await p.evaluate(() => document.getElementById('ttl').textContent);
  if (n < 400) errs.push(`THIN: ${k} (${n} chars)`);
  console.log(String(k).padEnd(16), String(n).padStart(7), t);
}
const links = await p.evaluate(() => document.querySelectorAll('#rail .rlink').length);
console.log('\nrail links:', links);
console.log(errs.length ? '\n--- ISSUES ---\n' + errs.join('\n') : '\nno errors');
await b.close();
