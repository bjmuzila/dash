import { chromium } from 'playwright';

const KEYS = ["Hub","Admin","Visitors","ControlPanel","Sales","Feedback","SocialMedia","PostStudio",
  "Changelog","Affiliates","Emails","MediaDump","BzilaAlerts","Results","Backtests","Probe","Greeks",
  "GexGrowth","DailyGrades","EstimatedMove","Watchlists","ChartsUI","LseData","Dev","Database",
  "Budget","Reta","Todo"];
const LOCKED = new Set(["Budget","Reta","Todo"]);
// Fail Rate is a placeholder in the real app too — same text, same size
const STUB_TABS = new Set(["Fail Rate","Brain"]);

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{ width:1500, height:1000 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

await p.goto('file:///home/claude/demo/dist/index.html');
await p.waitForTimeout(150);

let tabTotal = 0;
for (const k of KEYS) {
  await p.evaluate(kk => go(kk), k);
  await p.waitForTimeout(25);

  const n = await p.evaluate(() => document.querySelector('#view .page')?.innerHTML.length || 0);
  const min = LOCKED.has(k) ? 200 : 900;
  if (n < min) errs.push(`THIN: ${k} (${n} chars)`);

  // every tab on the page must render without error and change something
  const tabNames = await p.evaluate(() =>
    [...document.querySelectorAll('#view [data-tab]')].map(el => el.getAttribute('data-tab')));
  const seen = new Set();
  const sizes = [];
  for (const t of tabNames) {
    if (seen.has(t)) continue;
    seen.add(t);
    await p.evaluate(tt => {
      const el = [...document.querySelectorAll('#view [data-tab]')].find(e => e.getAttribute('data-tab') === tt);
      if (el) el.click();
    }, t);
    await p.waitForTimeout(20);
    const tn = await p.evaluate(() => document.querySelector('#view .page')?.innerHTML.length || 0);
    if (tn < min && !STUB_TABS.has(t)) errs.push(`THIN TAB: ${k} › ${t} (${tn} chars)`);
    sizes.push(tn);
  }
  tabTotal += seen.size;
  const distinct = new Set(sizes).size;
  if (seen.size > 1 && distinct === 1) errs.push(`INERT TABS: ${k} — ${seen.size} tabs all render identically`);

  console.log(String(k).padEnd(15), String(n).padStart(7), seen.size ? `${seen.size} tabs` : '');
}

const links = await p.evaluate(() => document.querySelectorAll('#rail .rlink').length);
console.log(`\nrail links: ${links}   tabs exercised: ${tabTotal}`);
console.log(errs.length ? '\n--- ISSUES ---\n' + errs.join('\n') : '\nno issues');
await b.close();
process.exit(errs.length ? 1 : 0);
