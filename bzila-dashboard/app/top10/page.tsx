"use client";

/**
 * dxFeed Top 10 Explorer — ranked movers across 5 universes + live sentiment heat-check.
 * Full React port of pages/old/top10.html (demo telemetry dataset preserved).
 */

import { useEffect, useMemo, useState } from "react";

type Row = [string, string, number, number, string]; // sym, name, price, chg, vol
interface Indicator { badge: string; symbol: string; desc: string; list: Row[] }
type IndKey = "abs_gain" | "rel_gain" | "abs_lose" | "rel_lose" | "volume";
interface Universe { name: string; indicators: Record<IndKey, Indicator> }

const TOP10: Record<string, Universe> = {
  sp500: { name: "S&P 500", indicators: {
    abs_gain: { badge: "Abs +", symbol: "$TOP10GSP", desc: "S&P 500 Top 10 Absolute Net Gainers", list: [["NVDA","NVIDIA Corp.",127.40,8.20,"52.1M"],["META","Meta Platforms",514.60,7.80,"12.2M"],["AMZN","Amazon.com",186.20,5.20,"23.5M"],["MSFT","Microsoft Corp.",421.80,4.10,"19.3M"],["GOOGL","Alphabet Inc.",181.90,3.95,"17.1M"],["AAPL","Apple Inc.",189.30,3.50,"28.4M"],["AMD","Advanced Micro",164.10,3.05,"26.0M"],["TSLA","Tesla Inc.",175.20,2.95,"31.2M"],["NFLX","Netflix Inc.",632.40,2.80,"5.5M"],["AVGO","Broadcom Inc.",1395.00,35.40,"4.1M"]] },
    rel_gain: { badge: "% +", symbol: "$TOP10PGSP", desc: "S&P 500 Top 10 Relative Gainers (%)", list: [["VRT","Vertiv Holdings",85.40,11.20,"14.2M"],["CEG","Constellation Energy",215.30,9.50,"6.8M"],["GEHC","GE HealthCare",82.40,4.20,"3.1M"],["COST","Costco Wholesale",792.00,12.50,"2.9M"],["SMCI","Super Micro Computer",812.00,14.70,"12.4M"],["HUM","Humana Inc.",357.20,3.80,"1.7M"],["AXON","Axon Enterprise",312.40,4.60,"1.4M"],["UBER","Uber Technologies",81.60,5.10,"11.2M"],["PANW","Palo Alto Networks",356.20,3.20,"2.4M"],["AMD","Advanced Micro",164.10,2.90,"26.0M"]] },
    abs_lose: { badge: "Abs -", symbol: "$TOP10LSP", desc: "S&P 500 Top 10 Absolute Net Losers", list: [["TSLA","Tesla Inc.",175.20,-10.40,"31.2M"],["INTC","Intel Corp.",30.15,-1.80,"45.1M"],["ALB","Albemarle Corp.",112.40,-2.10,"3.8M"],["FMC","FMC Corp.",58.30,-1.60,"2.9M"],["PFE","Pfizer Inc.",28.40,-1.95,"14.7M"],["BA","Boeing Co.",172.50,-8.40,"8.5M"],["DIS","Walt Disney Co.",101.20,-3.15,"7.2M"],["WMT","Walmart Inc.",68.30,-1.85,"8.1M"],["CVX","Chevron Corp.",154.20,-1.65,"4.3M"],["MCD","McDonalds Corp.",277.50,-2.10,"2.7M"]] },
    rel_lose: { badge: "% -", symbol: "$TOP10PLSP", desc: "S&P 500 Top 10 Relative Losers (%)", list: [["ALB","Albemarle Corp.",112.40,-10.50,"3.8M"],["FMC","FMC Corp.",58.30,-8.90,"2.9M"],["TSLA","Tesla Inc.",175.20,-6.10,"31.2M"],["PFE","Pfizer Inc.",28.40,-5.80,"14.7M"],["SNAP","Snap Inc.",15.30,-7.40,"21.1M"],["LCID","Lucid Group",2.50,-11.20,"45.1M"],["RBLX","Roblox Corp.",39.80,-9.70,"16.5M"],["SEDG","SolarEdge Tech",42.50,-14.50,"8.4M"],["ENPH","Enphase Energy",105.20,-12.80,"9.1M"],["ROKU","Roku Inc.",61.70,-4.25,"7.3M"]] },
    volume: { badge: "Vol", symbol: "$TOP10VSP", desc: "S&P 500 Top 10 Assets by Active Volume", list: [["NVDA","NVIDIA Corp.",127.40,6.40,"52.1M"],["INTC","Intel Corp.",30.15,-3.00,"45.1M"],["TSLA","Tesla Inc.",175.20,-10.40,"31.2M"],["AAPL","Apple Inc.",189.30,-1.25,"28.4M"],["AMZN","Amazon.com",186.20,5.20,"23.5M"],["MSFT","Microsoft Corp.",421.80,4.10,"19.3M"],["UBER","Uber Technologies",81.60,5.10,"11.2M"],["AMD","Advanced Micro",164.10,3.05,"26.0M"],["META","Meta Platforms",514.60,7.80,"12.2M"],["COST","Costco Wholesale",792.00,12.50,"2.9M"]] },
  }},
  nasdaq: { name: "NASDAQ", indicators: {
    abs_gain: { badge: "Abs +", symbol: "$TOP10G/Q", desc: "NASDAQ Top 10 Absolute Net Gainers", list: [["NVDA","NVIDIA Corp.",127.40,8.20,"52.1M"],["AVGO","Broadcom Inc.",1395.00,35.40,"4.1M"],["META","Meta Platforms",514.60,7.80,"12.2M"],["AMZN","Amazon.com",186.20,5.20,"23.5M"],["MSFT","Microsoft Corp.",421.80,4.10,"19.3M"],["GOOGL","Alphabet Inc.",181.90,3.95,"17.1M"],["AAPL","Apple Inc.",189.30,3.50,"28.4M"],["AMD","Advanced Micro",164.10,3.05,"26.0M"],["TSLA","Tesla Inc.",175.20,2.95,"31.2M"],["NFLX","Netflix Inc.",632.40,2.80,"5.5M"]] },
    rel_gain: { badge: "% +", symbol: "$TOP10PG/Q", desc: "NASDAQ Top 10 Relative Gainers (%)", list: [["SOUN","SoundHound AI Inc.",5.45,24.20,"41.5M"],["MARA","Marathon Digital",19.50,16.80,"38.6M"],["SMCI","Super Micro Computer",812.00,14.70,"12.4M"],["RDDT","Reddit Inc.",58.10,12.60,"9.2M"],["CRWD","CrowdStrike",397.20,9.80,"6.1M"],["DDOG","Datadog Inc.",122.50,8.90,"7.7M"],["ARM","Arm Holdings",128.40,7.60,"8.5M"],["MU","Micron Technology",154.30,6.90,"14.9M"],["ASML","ASML Holding",1024.50,5.80,"2.4M"],["UBER","Uber Technologies",81.60,5.10,"11.2M"]] },
    abs_lose: { badge: "Abs -", symbol: "$TOP10L/Q", desc: "NASDAQ Top 10 Absolute Net Losers", list: [["TSLA","Tesla Inc.",175.20,-10.40,"31.2M"],["AAPL","Apple Inc.",189.30,-4.25,"28.4M"],["INTC","Intel Corp.",30.15,-3.00,"45.1M"],["PDD","PDD Holdings",144.20,-2.55,"9.4M"],["PYPL","PayPal Holdings",63.10,-2.10,"16.4M"],["CSCO","Cisco Systems",45.50,-1.95,"12.7M"],["QCOM","Qualcomm Inc.",206.30,-1.80,"8.8M"],["LULU","Lululemon Athletica",301.10,-1.60,"4.4M"],["SNPS","Synopsys Inc.",561.20,-1.45,"2.1M"],["ADBE","Adobe Inc.",506.40,-1.25,"3.0M"]] },
    rel_lose: { badge: "% -", symbol: "$TOP10PL/Q", desc: "NASDAQ Top 10 Relative Losers (%)", list: [["SEDG","SolarEdge Tech",42.50,-14.50,"8.4M"],["ENPH","Enphase Energy",105.20,-12.80,"9.1M"],["LCID","Lucid Group",2.50,-11.20,"45.1M"],["RBLX","Roblox Corp.",39.80,-9.70,"16.5M"],["UPST","Upstart Holdings",26.40,-8.90,"6.5M"],["S","SentinelOne",18.30,-7.60,"10.2M"],["BMBL","Bumble Inc.",8.10,-6.40,"4.8M"],["DOCU","DocuSign Inc.",49.20,-5.80,"5.5M"],["SNAP","Snap Inc.",15.30,-4.90,"21.1M"],["ROKU","Roku Inc.",61.70,-4.25,"7.3M"]] },
    volume: { badge: "Vol", symbol: "$TOP10V/Q", desc: "NASDAQ Top 10 Assets by Active Volume", list: [["SOUN","SoundHound AI Inc.",5.45,24.20,"62.4M"],["MARA","Marathon Digital",19.50,16.80,"58.1M"],["NVDA","NVIDIA Corp.",127.40,8.20,"52.1M"],["INTC","Intel Corp.",30.15,-3.00,"45.1M"],["LCID","Lucid Group",2.50,-11.20,"45.1M"],["RBLX","Roblox Corp.",39.80,-9.70,"16.5M"],["AAPL","Apple Inc.",189.30,-4.25,"28.4M"],["TSLA","Tesla Inc.",175.20,-10.40,"31.2M"],["AMD","Advanced Micro",164.10,3.05,"26.0M"],["AMZN","Amazon.com",186.20,5.20,"23.5M"]] },
  }},
  nyse: { name: "NYSE", indicators: {
    abs_gain: { badge: "Abs +", symbol: "$TOP10GN", desc: "NYSE Top 10 Absolute Net Gainers", list: [["LLY","Eli Lilly & Co.",832.40,12.30,"4.1M"],["JPM","JPMorgan Chase",195.50,4.80,"9.2M"],["UNH","UnitedHealth Group",511.30,3.10,"3.6M"],["CAT","Caterpillar Inc.",345.10,6.20,"3.1M"],["MA","Mastercard Inc.",487.90,2.45,"2.8M"],["HD","Home Depot",358.70,1.95,"3.0M"],["XOM","Exxon Mobil",118.20,2.10,"14.4M"],["PG","Procter & Gamble",167.40,1.25,"4.0M"],["V","Visa Inc.",278.60,2.80,"4.7M"],["GS","Goldman Sachs",412.50,8.40,"2.4M"]] },
    rel_gain: { badge: "% +", symbol: "$TOP10PGN", desc: "NYSE Top 10 Relative Gainers (%)", list: [["GME","GameStop Corp.",22.40,18.50,"48.2M"],["AMC","AMC Entertainment",4.85,12.10,"32.4M"],["F","Ford Motor Co.",11.90,7.40,"42.8M"],["UAL","United Airlines",56.20,6.30,"11.6M"],["C","Citigroup Inc.",66.90,5.50,"8.8M"],["KHC","Kraft Heinz",31.80,5.00,"9.1M"],["T","AT&T Inc.",19.40,4.60,"31.8M"],["WFC","Wells Fargo",59.10,4.10,"10.4M"],["NKE","Nike Inc.",94.50,3.70,"7.0M"],["BA","Boeing Co.",172.50,3.20,"8.5M"]] },
    abs_lose: { badge: "Abs -", symbol: "$TOP10LN", desc: "NYSE Top 10 Absolute Net Losers", list: [["BA","Boeing Co.",172.50,-8.40,"8.5M"],["DIS","Walt Disney Co.",101.20,-3.15,"7.2M"],["KO","Coca-Cola Co.",61.90,-2.40,"5.9M"],["MCD","McDonalds Corp.",277.50,-2.10,"2.7M"],["WMT","Walmart Inc.",68.30,-1.85,"8.1M"],["CVX","Chevron Corp.",154.20,-1.65,"4.3M"],["SBUX","Starbucks Corp.",79.40,-1.50,"9.4M"],["TGT","Target Corp.",144.80,-1.20,"6.2M"],["LOW","Lowe's Companies",219.60,-1.05,"3.6M"],["DE","Deere & Co.",366.20,-0.95,"1.9M"]] },
    rel_lose: { badge: "% -", symbol: "$TOP10PLN", desc: "NYSE Top 10 Relative Losers (%)", list: [["CVNA","Carvana Co.",112.50,-11.40,"9.8M"],["UPST","Upstart Holdings",26.40,-9.50,"6.5M"],["MARA","Marathon Digital",19.50,-8.60,"38.6M"],["SNAP","Snap Inc.",15.30,-7.40,"21.1M"],["PLTR","Palantir Technologies",25.80,-6.30,"17.6M"],["RIVN","Rivian Automotive",13.20,-5.60,"19.4M"],["PFE","Pfizer Inc.",28.40,-4.20,"14.7M"],["INTC","Intel Corp.",30.15,-3.90,"45.1M"],["NIO","NIO Inc.",4.85,-3.50,"33.2M"],["CCL","Carnival Corp.",16.40,-2.85,"11.0M"]] },
    volume: { badge: "Vol", symbol: "$TOP10VN", desc: "NYSE Top 10 Assets by Active Volume", list: [["BAC","Bank of America",38.40,0.25,"54.2M"],["F","Ford Motor Co.",11.90,-0.45,"42.8M"],["CVNA","Carvana Co.",112.50,-11.40,"39.8M"],["GME","GameStop Corp.",22.40,18.50,"48.2M"],["MARA","Marathon Digital",19.50,-8.60,"38.6M"],["T","AT&T Inc.",19.40,4.60,"31.8M"],["SNAP","Snap Inc.",15.30,-7.40,"21.1M"],["RIVN","Rivian Automotive",13.20,-5.60,"19.4M"],["PLTR","Palantir Technologies",25.80,-6.30,"17.6M"],["XOM","Exxon Mobil",118.20,2.10,"14.4M"]] },
  }},
  dowjones: { name: "DOW JONES", indicators: {
    abs_gain: { badge: "Abs +", symbol: "$TOP10GI", desc: "Dow Jones Top 10 Absolute Net Gainers", list: [["GS","Goldman Sachs",412.50,8.40,"2.4M"],["CAT","Caterpillar Inc.",345.10,6.20,"3.1M"],["JPM","JPMorgan Chase",195.50,4.80,"9.2M"],["MMM","3M Company",94.50,1.80,"5.4M"],["AXP","American Express",220.40,3.10,"3.2M"],["UNH","UnitedHealth Group",511.30,3.10,"3.6M"],["V","Visa Inc.",278.60,2.80,"4.7M"],["HD","Home Depot",358.70,1.95,"3.0M"],["MCD","McDonalds Corp.",277.50,2.10,"2.7M"],["NKE","Nike Inc.",94.50,3.70,"7.0M"]] },
    rel_gain: { badge: "% +", symbol: "$TOP10PGI", desc: "Dow Jones Top 10 Relative Gainers (%)", list: [["GS","Goldman Sachs",412.50,2.08,"2.4M"],["CAT","Caterpillar Inc.",345.10,1.83,"3.1M"],["JPM","JPMorgan Chase",195.50,1.67,"9.2M"],["AXP","American Express",220.40,1.43,"3.2M"],["UNH","UnitedHealth Group",511.30,0.61,"3.6M"],["HD","Home Depot",358.70,0.55,"3.0M"],["V","Visa Inc.",278.60,0.51,"4.7M"],["MCD","McDonalds Corp.",277.50,0.48,"2.7M"],["NKE","Nike Inc.",94.50,0.39,"7.0M"],["MMM","3M Company",94.50,0.28,"5.4M"]] },
    abs_lose: { badge: "Abs -", symbol: "$TOP10LI", desc: "Dow Jones Top 10 Absolute Net Losers", list: [["BA","Boeing Co.",172.50,-8.40,"8.5M"],["AXP","American Express",220.40,-4.10,"3.2M"],["MMM","3M Company",94.50,-2.70,"5.4M"],["DIS","Walt Disney Co.",101.20,-3.15,"7.2M"],["VZ","Verizon Communications",40.20,-1.20,"14.1M"],["CSCO","Cisco Systems",45.50,-1.95,"12.7M"],["INTC","Intel Corp.",30.15,-3.00,"45.1M"],["PFE","Pfizer Inc.",28.40,-1.95,"14.7M"],["KO","Coca-Cola Co.",61.90,-2.40,"5.9M"],["WMT","Walmart Inc.",68.30,-1.85,"8.1M"]] },
    rel_lose: { badge: "% -", symbol: "$TOP10PLI", desc: "Dow Jones Top 10 Relative Losers (%)", list: [["BA","Boeing Co.",172.50,-4.64,"8.5M"],["MMM","3M Company",94.50,-2.17,"5.4M"],["AXP","American Express",220.40,-1.82,"3.2M"],["DIS","Walt Disney Co.",101.20,-1.69,"7.2M"],["PFE","Pfizer Inc.",28.40,-1.50,"14.7M"],["KO","Coca-Cola Co.",61.90,-1.40,"5.9M"],["VZ","Verizon Communications",40.20,-1.10,"14.1M"],["CSCO","Cisco Systems",45.50,-0.95,"12.7M"],["WMT","Walmart Inc.",68.30,-0.85,"8.1M"],["NKE","Nike Inc.",94.50,-0.77,"7.0M"]] },
    volume: { badge: "Vol", symbol: "$TOP10VI", desc: "Dow Jones Top 10 Assets by Active Volume", list: [["INTC","Intel Corp.",30.15,-3.00,"45.1M"],["AAPL","Apple Inc.",189.30,-1.25,"28.4M"],["BA","Boeing Co.",172.50,-8.40,"8.5M"],["JPM","JPMorgan Chase",195.50,4.80,"9.2M"],["AXP","American Express",220.40,-4.10,"3.2M"],["DIS","Walt Disney Co.",101.20,-3.15,"7.2M"],["MMM","3M Company",94.50,-2.70,"5.4M"],["CSCO","Cisco Systems",45.50,-1.95,"12.7M"],["PFE","Pfizer Inc.",28.40,-1.95,"14.7M"],["KO","Coca-Cola Co.",61.90,-2.40,"5.9M"]] },
  }},
  allusa: { name: "ALL USA", indicators: {
    abs_gain: { badge: "Abs +", symbol: "$TOP10GUS", desc: "ALLUSA Top 10 Absolute Net Gainers", list: [["SMCI","Super Micro Computer",812.00,48.50,"12.4M"],["LLY","Eli Lilly & Co.",832.40,12.30,"4.1M"],["NVDA","NVIDIA Corp.",127.40,8.20,"52.1M"],["AVGO","Broadcom Inc.",1395.00,35.40,"4.1M"],["GME","GameStop Corp.",22.40,18.50,"48.2M"],["SOUN","SoundHound AI Inc.",5.45,24.20,"41.5M"],["MARA","Marathon Digital",19.50,16.80,"38.6M"],["COST","Costco Wholesale",792.00,12.50,"2.9M"],["JPM","JPMorgan Chase",195.50,4.80,"9.2M"],["VRT","Vertiv Holdings",85.40,11.20,"14.2M"]] },
    rel_gain: { badge: "% +", symbol: "$TOP10PGUS", desc: "ALLUSA Top 10 Relative Gainers (%)", list: [["SOUN","SoundHound AI Inc.",5.45,24.20,"41.5M"],["GME","GameStop Corp.",22.40,18.50,"48.2M"],["MARA","Marathon Digital",19.50,16.80,"38.6M"],["SMCI","Super Micro Computer",812.00,14.70,"12.4M"],["COST","Costco Wholesale",792.00,12.50,"2.9M"],["VRT","Vertiv Holdings",85.40,11.20,"14.2M"],["CEG","Constellation Energy",215.30,9.50,"6.8M"],["CRWD","CrowdStrike",397.20,9.80,"6.1M"],["NVDA","NVIDIA Corp.",127.40,8.20,"52.1M"],["AVGO","Broadcom Inc.",1395.00,35.40,"4.1M"]] },
    abs_lose: { badge: "Abs -", symbol: "$TOP10LUS", desc: "ALLUSA Top 10 Absolute Net Losers", list: [["LRCX","Lam Research Corp.",942.00,-32.50,"2.1M"],["TSLA","Tesla Inc.",175.20,-10.40,"31.2M"],["INTC","Intel Corp.",30.15,-3.00,"45.1M"],["PFE","Pfizer Inc.",28.40,-1.95,"14.7M"],["DIS","Walt Disney Co.",101.20,-3.15,"7.2M"],["KO","Coca-Cola Co.",61.90,-2.40,"5.9M"],["WMT","Walmart Inc.",68.30,-1.85,"8.1M"],["BA","Boeing Co.",172.50,-8.40,"8.5M"],["ROKU","Roku Inc.",61.70,-4.25,"7.3M"],["ENPH","Enphase Energy",105.20,-12.80,"9.1M"]] },
    rel_lose: { badge: "% -", symbol: "$TOP10PLUS", desc: "ALLUSA Top 10 Relative Losers (%)", list: [["SEDG","SolarEdge Tech",42.50,-14.50,"8.4M"],["ENPH","Enphase Energy",105.20,-12.80,"9.1M"],["LCID","Lucid Group",2.50,-11.20,"45.1M"],["RBLX","Roblox Corp.",39.80,-9.70,"16.5M"],["UPST","Upstart Holdings",26.40,-8.90,"6.5M"],["SNAP","Snap Inc.",15.30,-7.40,"21.1M"],["PLTR","Palantir Technologies",25.80,-6.30,"17.6M"],["TSLA","Tesla Inc.",175.20,-10.40,"31.2M"],["PFE","Pfizer Inc.",28.40,-5.80,"14.7M"],["ROKU","Roku Inc.",61.70,-4.25,"7.3M"]] },
    volume: { badge: "Vol", symbol: "$TOP10VUS", desc: "ALLUSA Top 10 Assets by Active Volume", list: [["SOUN","SoundHound AI Inc.",5.45,24.20,"62.4M"],["MARA","Marathon Digital",19.50,16.80,"58.1M"],["NVDA","NVIDIA Corp.",127.40,8.20,"52.1M"],["INTC","Intel Corp.",30.15,-3.00,"45.1M"],["LCID","Lucid Group",2.50,-11.20,"45.1M"],["RBLX","Roblox Corp.",39.80,-9.70,"16.5M"],["AAPL","Apple Inc.",189.30,-4.25,"28.4M"],["TSLA","Tesla Inc.",175.20,-10.40,"31.2M"],["AMD","Advanced Micro",164.10,3.05,"26.0M"],["AMZN","Amazon.com",186.20,5.20,"23.5M"]] },
  }},
};

const IND_KEYS: IndKey[] = ["abs_gain", "rel_gain", "abs_lose", "rel_lose", "volume"];
const UNIVERSES = ["sp500", "nasdaq", "nyse", "dowjones", "allusa"];

const fmtChg = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
const titleCase = (s: string) => s.replace("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());

function clamp(v: number, mn: number, mx: number) { return Math.max(mn, Math.min(mx, v)); }
function walk(v: number, step: number, mn: number, mx: number) { return clamp(v + (Math.random() - 0.5) * 2 * step, mn, mx); }

function SentimentBar({ pct, barColor, trackColor = "#f87171" }: { pct: number; barColor: string; trackColor?: string }) {
  return (
    <div style={{ background: trackColor, borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 6 }}>
      <div style={{ height: "100%", borderRadius: 4, background: barColor, width: `${pct}%`, transition: "width .4s ease" }} />
    </div>
  );
}

export default function Top10Page() {
  const [active, setActive] = useState("sp500");
  const [clock, setClock] = useState("--:--:-- --");
  const [sent, setSent] = useState({ trin: 0.95, avol: 462, dvol: 312, adv: 468, dec: 334 });
  const [btnState, setBtnState] = useState<Record<string, string>>({});

  // Clock + telemetry random walk (matches vanilla cadence)
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
    }));
    tick();
    const clockId = setInterval(tick, 1000);
    const telId = setInterval(() => {
      setSent((s) => ({
        trin: walk(s.trin, 0.06, 0.4, 2.0),
        avol: walk(s.avol, 15, 100, 900),
        dvol: walk(s.dvol, 15, 100, 900),
        adv: walk(s.adv, 12, 50, 450),
        dec: walk(s.dec, 12, 50, 450),
      }));
    }, 2000);
    return () => { clearInterval(clockId); clearInterval(telId); };
  }, []);

  const g = TOP10[active];
  const trinColor = sent.trin < 0.85 ? "#10b981" : sent.trin > 1.25 ? "#f43f5e" : "#f59e0b";
  const volPct = (sent.avol / (sent.avol + sent.dvol)) * 100;
  const brPct = (sent.adv / (sent.adv + sent.dec)) * 100;

  const snapshot = useMemo(() => () => {
    const lines = [`# Top 10 Snapshot`, ``, `Universe: ${g.name}`, `Time: ${clock}`, ``];
    IND_KEYS.forEach((k) => {
      const ind = g.indicators[k];
      lines.push(`## ${titleCase(k)}`);
      lines.push(`${ind.symbol} | ${ind.desc}`);
      ind.list.slice(0, 10).forEach(([sym, name, price, chg]) => {
        const pct = k === "rel_gain" || k === "rel_lose" ? "%" : "";
        lines.push(`- ${sym} | $${price.toFixed(2)} | ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}${pct} | ${name}`);
      });
      lines.push("");
    });
    return lines.join("\n").trim();
  }, [g, clock]);

  const flash = (key: string, state: string) => {
    setBtnState((s) => ({ ...s, [key]: state }));
    if (state !== "…") setTimeout(() => setBtnState((s) => ({ ...s, [key]: "" })), 1500);
  };

  const copySnapshot = async () => {
    flash("copy", "…");
    try {
      await navigator.clipboard.writeText(snapshot());
      flash("copy", "✓");
    } catch { flash("copy", "ERR"); }
  };

  const share = async (platform: "x" | "discord") => {
    const snap = snapshot();
    if (platform === "x") {
      try { await navigator.clipboard.writeText(snap); } catch { /* open anyway */ }
      const tweet = snap.split("\n").slice(0, 8).join("\n").slice(0, 240);
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, "_blank", "noopener,noreferrer");
      return;
    }
    flash("discord", "…");
    try {
      const form = new FormData();
      form.append("payload_json", JSON.stringify({ content: `Top 10 Snapshot\n\n\`\`\`\n${snap.slice(0, 1800)}\n\`\`\`` }));
      const res = await fetch("/api/discord-share", { method: "POST", body: form });
      if (!res.ok) throw new Error("webhook failed");
      flash("discord", "✓");
    } catch { flash("discord", "ERR"); }
  };

  const shotBtn = (key: string, normal: string, color: string, onClick: () => void) => {
    const s = btnState[key];
    return (
      <button onClick={onClick} disabled={s === "…"} style={{
        fontSize: 9, padding: "2px 8px", border: "none", borderRadius: 2,
        background: "transparent", fontWeight: 700, cursor: "pointer",
        color: s === "✓" ? "#00e676" : s === "ERR" ? "#ff4757" : s === "…" ? "#ffb300" : color,
      }}>
        {s || normal}
      </button>
    );
  };

  const sentCard = (title: string, right: React.ReactNode, bar: React.ReactNode, foot: React.ReactNode) => (
    <div style={{ background: "rgba(9,9,11,.55)", border: "1px solid rgba(39,39,42,.75)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#f8fafc" }}>{title}</span>
        {right}
      </div>
      {bar}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#64748b" }}>{foot}</div>
    </div>
  );

  return (
    <div style={{
      flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column",
      padding: 10, color: "#f8fafc", fontFamily: "Arial, Helvetica, sans-serif",
      background: "radial-gradient(circle at top left, rgba(0,229,255,.08), transparent 25%), radial-gradient(circle at top right, rgba(129,140,248,.08), transparent 24%), #05080d",
    }}>
      {/* Top header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "#fff", letterSpacing: ".16em", textTransform: "uppercase", fontWeight: 700 }}>Bzila Suite</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 3 }}>dxFeed Top 10 Explorer</div>
          <div style={{ fontSize: 11, maxWidth: 760, lineHeight: 1.35, marginTop: 4, color: "#fff" }}>
            A compact market breadth explorer for the five dxFeed universes with ranked movers and active volume views.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace", letterSpacing: ".08em" }}>EST: {clock}</div>
          </div>
          <div style={{ display: "flex", gap: 4, background: "#070c14", borderRadius: 2, padding: 2 }}>
            {shotBtn("copy", "COPY", "#00e5ff", copySnapshot)}
            {shotBtn("x", "X", "#00e5ff", () => share("x"))}
            {shotBtn("discord", "DISCORD", "#7289da", () => share("discord"))}
          </div>
        </div>
      </div>

      {/* Sentiment heat-check */}
      <div style={{
        background: "linear-gradient(180deg,rgba(13,17,23,.96),rgba(8,12,16,.96))",
        border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: "10px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,.3)", marginBottom: 10, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#34d399", fontSize: 13, lineHeight: 1 }}>⌇</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase" }}>Live Sentiment Heat-Check</span>
          </div>
          <span style={{ fontSize: 9, color: "#64748b" }}>Broad system internal indicators &amp; safety thresholds</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          {sentCard("NYSE Arms Index ($TRIN)",
            <span style={{ fontSize: 14, fontWeight: 800, color: trinColor, fontFamily: "monospace" }}>{sent.trin.toFixed(2)}</span>,
            <SentimentBar pct={clamp((sent.trin / 2) * 100, 10, 100)} barColor={trinColor} trackColor="rgba(39,39,42,.5)" />,
            <><span>0.4 (Extreme Bullish)</span><span>1.0 (Fair Value)</span><span>2.0+ (Extreme Panic)</span></>)}
          {sentCard("NYSE Volumetric Flow Split",
            <div style={{ display: "flex", gap: 8, fontSize: 9, fontFamily: "monospace" }}>
              <span style={{ color: "#34d399" }}>Up: {Math.round(sent.avol)}M</span>
              <span style={{ color: "#f87171" }}>Down: {Math.round(sent.dvol)}M</span>
            </div>,
            <SentimentBar pct={volPct} barColor="#34d399" />,
            <><span>{volPct.toFixed(0)}% Advancing Vol</span><span>{(100 - volPct).toFixed(0)}% Declining Vol</span></>)}
          {sentCard("S&P 500 Broad Breadth Rate",
            <div style={{ display: "flex", gap: 8, fontSize: 9, fontFamily: "monospace" }}>
              <span style={{ color: "#34d399" }}>Adv: {Math.round(sent.adv)}</span>
              <span style={{ color: "#f87171" }}>Dec: {Math.round(sent.dec)}</span>
            </div>,
            <SentimentBar pct={brPct} barColor="#34d399" />,
            <><span>{brPct.toFixed(0)}% Higher</span><span>{(100 - brPct).toFixed(0)}% Lower</span></>)}
        </div>
      </div>

      {/* Main card */}
      <div style={{
        background: "linear-gradient(180deg,rgba(13,17,23,.96),rgba(8,12,16,.96))",
        border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: 10,
        boxShadow: "0 18px 50px rgba(0,0,0,.35)", flex: 1, minHeight: 0,
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
          flexWrap: "wrap", borderBottom: "1px solid rgba(255,255,255,.06)", paddingBottom: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: "rgba(79,70,229,.12)", color: "#818cf8", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(99,102,241,.2)" }}>✦</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>Bzila Communities • dxFeed $TOP10 Multi-Feature Explorer</div>
              <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: ".08em", textTransform: "uppercase" }}>
                Realtime-like ranked movers across NYSE, NASDAQ, S&amp;P 500, DOW JONES, and ALL USA
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {UNIVERSES.map((k) => (
              <button key={k} onClick={() => setActive(k)} style={{
                padding: "6px 10px", fontSize: 10, fontWeight: 800, borderRadius: 7,
                border: active === k ? "1px solid rgba(99,102,241,.35)" : "1px solid rgba(39,39,42,.9)",
                background: active === k ? "#4f46e5" : "rgba(9,9,11,.55)",
                color: active === k ? "#fff" : "#94a3b8", cursor: "pointer",
              }}>
                {TOP10[k].name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8, flex: 1, minHeight: 0, overflow: "hidden", marginTop: 10 }}>
          {IND_KEYS.map((k) => {
            const ind = g.indicators[k];
            return (
              <div key={k} style={{
                background: "rgba(9,9,11,.45)", border: "1px solid rgba(39,39,42,.75)",
                borderRadius: 10, padding: 7, minHeight: 0, overflow: "hidden",
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5, borderBottom: "1px solid rgba(255,255,255,.06)", paddingBottom: 5, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#cbd5e1" }}>{titleCase(k)}</span>
                  <span style={{ fontSize: 8, fontWeight: 800, padding: "2px 6px", borderRadius: 999, border: "1px solid rgba(255,255,255,.1)", color: "#818cf8" }}>{ind.badge}</span>
                </div>
                <div style={{
                  fontSize: 8, marginBottom: 6, display: "flex", justifyContent: "space-between", gap: 8,
                  background: "rgba(9,9,11,.8)", padding: "4px 6px", border: "1px solid rgba(39,39,42,.85)",
                  borderRadius: 8, flexShrink: 0, color: "#fff",
                }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ind.desc}</span>
                  <span style={{ color: "#818cf8", fontWeight: 700, flexShrink: 0 }}>{ind.symbol}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minHeight: 0, overflowY: "auto" }}>
                  {ind.list.slice(0, 10).map(([sym, name, price, chg], i) => (
                    <div key={i} style={{
                      padding: 4, border: "1px solid rgba(39,39,42,.65)", borderRadius: 8,
                      background: "rgba(9,9,11,.45)", display: "flex", justifyContent: "space-between",
                      gap: 6, fontSize: 9, lineHeight: 1.15,
                    }}>
                      <div style={{ display: "flex", gap: 5, alignItems: "center", minWidth: 0 }}>
                        <span style={{ fontWeight: 800, fontSize: 12, color: "#fff" }}>{sym}</span>
                        <span style={{ fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 72, color: "#fff" }}>{name}</span>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 12, color: "#fff" }}>${price.toFixed(2)}</div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: chg >= 0 ? "#34d399" : "#f87171" }}>
                          {fmtChg(chg)}{k === "rel_gain" || k === "rel_lose" ? "%" : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
          fontSize: 9, color: "#64748b", fontFamily: "monospace", marginTop: 8,
          borderTop: "1px solid rgba(255,255,255,.06)", paddingTop: 8, flexShrink: 0,
        }}>
          <span>* Telemetry intervals update together from the same dxFeed formula stream model.</span>
          <span style={{ color: "#34d399" }}>Live Telemetry Feed</span>
        </div>
      </div>
    </div>
  );
}
