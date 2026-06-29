import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/pinescript?ticker=SPX
 *
 * Reads the latest ticker_levels row and returns a ready-to-paste Pine v5
 * indicator with the EM up/down bands (and pivot/zones) baked in as inputs.
 * Pine cannot call this API, so the values are frozen into the script text;
 * regenerate after a fresh EM publish to refresh them.
 *
 * Query params:
 *   ticker   (required)  e.g. SPX, ES, AAPL
 *   format=json          return { ticker, pine } instead of raw text/plain
 */

const ALIAS: Record<string, string> = {
  ES: "ESU", ESM: "ESU", ESU6: "ESU", ESU26: "ESU", "/ES": "ESU",
  NQ: "NQU", NQM: "NQU", NQU6: "NQU", NQU26: "NQU", "/NQ": "NQU",
};

// Parse a TradingView watchlist export into a set of bare, aliased tickers.
// Handles "EXCHANGE:SYMBOL", ###section dividers, futures suffixes, and aliases.
function parseWatchlist(raw: string): Set<string> {
  const out = new Set<string>();
  for (const tok of raw.split(/[,\s]+/)) {
    let s = tok.trim().toUpperCase();
    if (!s || s.startsWith("#")) continue;        // section divider / blank
    if (s.includes(":")) s = s.split(":")[1];     // drop EXCHANGE: prefix
    s = s.replace(/[$]/g, "").replace(/^\//, "");  // $ and leading /
    // Normalize futures: ESU2026, ES1!, ESM → ESU ; NQ… → NQU
    if (/^ES/.test(s) || s === "ES1!") s = "ESU";
    else if (/^NQ/.test(s) || s === "NQ1!") s = "NQU";
    else s = ALIAS[s] || s;
    if (s) out.add(s);
  }
  return out;
}

type Row = {
  ticker: string;
  label: string | null;
  close: string | null;
  em: string | null;
  up: string | null;
  down: string | null;
  buy_near: string | null;
  buy_far: string | null;
  sell_near: string | null;
  sell_far: string | null;
  pivot: string | null;
  exp_label: string | null;
  em_updated_at: string | null;
};

// Parse the TEXT columns (they may carry $, commas, etc.) into a float or NaN.
function num(v: string | null | undefined): number {
  if (v == null) return NaN;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

// na for an absent level so Pine just skips the plot rather than drawing 0.
function pineNum(v: string | null | undefined): string {
  const n = num(v);
  return Number.isFinite(n) ? String(n) : "na";
}

function buildPine(row: Row): string {
  const sym = (row.label || row.ticker || "TICKER").toUpperCase();
  const stamp = row.em_updated_at
    ? new Date(row.em_updated_at).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const exp = row.exp_label ? ` (${row.exp_label})` : "";

  return `//@version=6
// ${sym} Estimated Moves & Levels${exp}
// Auto-generated ${stamp} — values frozen; regenerate after a fresh EM publish.
indicator("${sym} EM & Levels", overlay=true, max_lines_count=100, max_labels_count=100)

// ── Baked-in values (plain constants — hidden from the Inputs panel) ──
emUp     = ${pineNum(row.up)}
emDown   = ${pineNum(row.down)}
emClose  = ${pineNum(row.close)}
pivot    = ${pineNum(row.pivot)}
buyNear  = ${pineNum(row.buy_near)}
buyFar   = ${pineNum(row.buy_far)}
sellNear = ${pineNum(row.sell_near)}
sellFar  = ${pineNum(row.sell_far)}

// ── Display options ──────────────────────────────────────────────
showClose = input.bool(true,  "Show reference close", group="Display")
showZones = input.bool(true,  "Show buy/sell zones",  group="Display")
showLabel = input.bool(true,  "Show price labels",    group="Display")
labelOff  = input.int(20, "Label offset (bars)", minval=0, maxval=200, group="Display", tooltip="Pushes price labels right toward the price axis.")
extend    = input.string("Both", "Line extension", options=["Right","Both","None"], group="Display")

ext = extend == "Both" ? extend.both : extend == "None" ? extend.none : extend.right

// ── Colors ───────────────────────────────────────────────────────
cUp    = color.new(#2962ff, 0)   // EM blue
cDown  = color.new(#2962ff, 0)   // EM blue
cClose = color.new(#b0b0b0, 0)   // light grey
cPivot = color.new(#b0b0b0, 0)   // light grey
cBuy   = color.new(#b0b0b0, 0)   // light grey
cSell  = color.new(#b0b0b0, 0)   // light grey

// ── Draw once per chart (on the last bar) ────────────────────────
// Helpers take a show flag and always return a typed line/label (na when
// hidden) — so call-site assignments are never bare untyped na.
f_line(bool show, float price, color col, string style) =>
    line out = na
    if show and not na(price)
        out := line.new(bar_index - 1, price, bar_index, price, xloc=xloc.bar_index, extend=ext, color=col, style=line.style_solid, width=2)
    out

f_tag(bool show, float price, string txt, color col) =>
    label out = na
    if show and showLabel and not na(price)
        out := label.new(bar_index + labelOff, price, txt + "  " + str.tostring(price, format.mintick), xloc=xloc.bar_index, style=label.style_label_left, color=color.new(col, 100), textcolor=col, size=size.small, textalign=text.align_right)
    out

// A shaded zone box spanning two prices, extending right from the last bar.
f_box(bool show, float a, float b, color col) =>
    box out = na
    if show and not na(a) and not na(b)
        out := box.new(bar_index, math.max(a, b), bar_index + 30, math.min(a, b), border_color=color.new(col, 100), bgcolor=color.new(col, 82), extend=ext == extend.none ? extend.none : extend.right)
    out

var line lUp = na
var line lDown = na
var line lClose = na
var line lPivot = na
var box bBuy = na
var box bSell = na
var label tUp = na
var label tDown = na
var label tClose = na
var label tPivot = na

if barstate.islast
    line.delete(lUp),  line.delete(lDown), line.delete(lClose), line.delete(lPivot)
    box.delete(bBuy),  box.delete(bSell)
    label.delete(tUp), label.delete(tDown),label.delete(tClose),label.delete(tPivot)

    lUp    := f_line(true,      emUp,     cUp,    line.style_solid)
    lDown  := f_line(true,      emDown,   cDown,  line.style_solid)
    lClose := f_line(showClose, emClose,  cClose, line.style_solid)
    lPivot := f_line(showZones, pivot,    cPivot, line.style_solid)
    bBuy   := f_box(showZones,  buyNear,  buyFar,  cBuy)
    bSell  := f_box(showZones,  sellNear, sellFar, cSell)

    tUp    := f_tag(true,      emUp,    "EM Up",   cUp)
    tDown  := f_tag(true,      emDown,  "EM Down", cDown)
    tClose := f_tag(showClose, emClose, "Close",   cClose)
    tPivot := f_tag(showZones, pivot,   "Pivot",   cPivot)

`;
}

// Core watchlist for the combined ("all") indicator. Display labels as stored.
const CORE = ["SPX", "NDX", "ESU", "NQU", "SPY", "QQQ", "IWM"];

/**
 * One COMBINED indicator for several tickers. Each ticker's levels live in their
 * own input.float group. A dropdown ("Show ticker") picks which set to draw, with
 * "Auto" matching the chart symbol via syminfo.ticker. No duplicate variable
 * names — values are looked up by the selected ticker through arrays.
 */
function buildPineAll(rows: Row[], filter?: Set<string>): string {
  const byTicker = new Map(rows.map((r) => [String(r.label || r.ticker).toUpperCase(), r]));
  // If a filter (watchlist) is given, keep only those tickers that also have a
  // levels row. Otherwise use the full roster. Core first for Auto-match.
  const keys = filter
    ? [...byTicker.keys()].filter((t) => filter.has(t))
    : [...byTicker.keys()];
  const rest = keys.filter((t) => !CORE.includes(t)).sort();
  const order = [...CORE.filter((t) => byTicker.has(t) && (!filter || filter.has(t))), ...rest];
  if (!order.length) return "// no matching levels found";

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  // Values written DIRECTLY into array.set (no per-ticker named constants), so
  // the script stays small and avoids invalid identifiers (e.g. BRK.B) and the
  // local-variable cap. Values are hidden from the Inputs panel either way.
  const pushes: string[] = [];
  order.forEach((t, i) => {
    const r = byTicker.get(t)!;
    pushes.push(
      [
        `array.set(NAMES,${i},"${t}")`,
        `array.set(UP,${i},${pineNum(r.up)})`,
        `array.set(DN,${i},${pineNum(r.down)})`,
        `array.set(CL,${i},${pineNum(r.close)})`,
        `array.set(PV,${i},${pineNum(r.pivot)})`,
        `array.set(BN,${i},${pineNum(r.buy_near)})`,
        `array.set(BF,${i},${pineNum(r.buy_far)})`,
        `array.set(SN,${i},${pineNum(r.sell_near)})`,
        `array.set(SF,${i},${pineNum(r.sell_far)})`,
      ].join("\n    ")
    );
  });

  const n = order.length;
  const dropdownOpts = ["Auto", ...order].map((o) => `"${o}"`).join(", ");

  return `//@version=6
// Core EM & Levels (combined) — ${order.join(", ")}
// Auto-generated ${stamp} — values frozen; regenerate after a fresh EM publish.
// "Show ticker"=Auto draws the set whose name matches the chart symbol.
indicator("Core EM & Levels", overlay=true, max_lines_count=60, max_labels_count=60)

sel       = input.string("Auto", "Show ticker", options=[${dropdownOpts}], group="Display")
showClose = input.bool(true,  "Show reference close",group="Display")
showZones = input.bool(true,  "Show buy/sell zones", group="Display")
showLabel = input.bool(true,  "Show price labels",   group="Display")
labelOff  = input.int(20, "Label offset (bars)", minval=0, maxval=200, group="Display", tooltip="Pushes price labels right toward the price axis.")
extOpt    = input.string("Both", "Line extension", options=["Right","Both","None"], group="Display")
ext = extOpt == "Both" ? extend.both : extOpt == "None" ? extend.none : extend.right

// ── Per-ticker levels packed into arrays (values hidden from Inputs) ──
var NAMES = array.new_string(${n})
var UP = array.new_float(${n})
var DN = array.new_float(${n})
var CL = array.new_float(${n})
var PV = array.new_float(${n})
var BN = array.new_float(${n})
var BF = array.new_float(${n})
var SN = array.new_float(${n})
var SF = array.new_float(${n})
if barstate.isfirst
    ${pushes.join("\n    ")}

// Resolve index: explicit dropdown, else Auto-match the chart symbol.
f_idx() =>
    int idx = -1
    sym = str.upper(syminfo.ticker)
    if sel != "Auto"
        for i = 0 to ${n - 1}
            if array.get(NAMES, i) == sel
                idx := i
    else
        // Exact match first (chart symbol == ticker name).
        for i = 0 to ${n - 1}
            if idx < 0 and array.get(NAMES, i) == sym
                idx := i
        // Fallback: prefer the LONGEST name contained in the symbol, so e.g.
        // an NVDA chart can't get hijacked by short names like "V" or "MA".
        if idx < 0
            int best = -1
            for i = 0 to ${n - 1}
                nm = array.get(NAMES, i)
                if str.contains(sym, nm) and str.length(nm) > best
                    best := str.length(nm)
                    idx := i
    idx
idx = f_idx()

emUp    = idx >= 0 ? array.get(UP, idx) : na
emDown  = idx >= 0 ? array.get(DN, idx) : na
emClose = idx >= 0 ? array.get(CL, idx) : na
pivot   = idx >= 0 ? array.get(PV, idx) : na
buyNear = idx >= 0 ? array.get(BN, idx) : na
buyFar  = idx >= 0 ? array.get(BF, idx) : na
sellNear= idx >= 0 ? array.get(SN, idx) : na
sellFar = idx >= 0 ? array.get(SF, idx) : na

// ── Colors ───────────────────────────────────────────────────────
cUp=color.new(#2962ff,0), cDown=color.new(#2962ff,0), cClose=color.new(#b0b0b0,0)
cPivot=color.new(#b0b0b0,0), cBuy=color.new(#b0b0b0,0), cSell=color.new(#b0b0b0,0)

f_line(bool show, float p, color col, string style) =>
    line out = na
    if show and not na(p)
        out := line.new(bar_index-1, p, bar_index, p, xloc=xloc.bar_index, extend=ext, color=col, style=line.style_solid, width=2)
    out
f_tag(bool show, float p, string txt, color col) =>
    label out = na
    if show and showLabel and not na(p)
        out := label.new(bar_index + labelOff, p, txt+"  "+str.tostring(p,format.mintick), xloc=xloc.bar_index, style=label.style_label_left, color=color.new(col,100), textcolor=col, size=size.small, textalign=text.align_right)
    out
f_box(bool show, float a, float b, color col) =>
    box out = na
    if show and not na(a) and not na(b)
        out := box.new(bar_index, math.max(a,b), bar_index+30, math.min(a,b), border_color=color.new(col,100), bgcolor=color.new(col,82), extend=ext == extend.none ? extend.none : extend.right)
    out

var line lUp = na
var line lDown = na
var line lClose = na
var line lPivot = na
var box bBuy = na
var box bSell = na
var label tUp = na
var label tDown = na
var label tClose = na
var label tPivot = na

if barstate.islast
    line.delete(lUp),line.delete(lDown),line.delete(lClose),line.delete(lPivot)
    box.delete(bBuy),box.delete(bSell)
    label.delete(tUp),label.delete(tDown),label.delete(tClose),label.delete(tPivot)

    lUp    := f_line(true,      emUp,     cUp,    line.style_solid)
    lDown  := f_line(true,      emDown,   cDown,  line.style_solid)
    lClose := f_line(showClose, emClose,  cClose, line.style_solid)
    lPivot := f_line(showZones, pivot,    cPivot, line.style_solid)
    bBuy   := f_box(showZones,  buyNear,  buyFar,  cBuy)
    bSell  := f_box(showZones,  sellNear, sellFar, cSell)

    tUp    := f_tag(true,      emUp,    "EM Up",   cUp)
    tDown  := f_tag(true,      emDown,  "EM Down", cDown)
    tClose := f_tag(showClose, emClose, "Close",   cClose)
    tPivot := f_tag(showZones, pivot,   "Pivot",   cPivot)

`;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const raw = (sp.get("ticker") || "").trim().toUpperCase();
    const wantAll = sp.get("all") === "1" || raw === "ALL";
    const asJson = sp.get("format") === "json";

    const pool = await getDb();

    // Combined indicator. Optional ?symbols=<watchlist export> filters to those
    // tickers (intersected with rows that actually have levels). No symbols =
    // full roster.
    if (wantAll) {
      const result = await pool.query("SELECT * FROM ticker_levels ORDER BY ticker ASC");
      if (!result.rows.length) {
        return NextResponse.json({ error: "no levels found" }, { status: 404 });
      }
      const symbolsRaw = sp.get("symbols") || "";
      const filter = symbolsRaw.trim() ? parseWatchlist(symbolsRaw) : undefined;
      const pine = buildPineAll(result.rows as Row[], filter);
      if (asJson) return NextResponse.json({ ticker: "ALL", pine });
      return new NextResponse(pine, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `inline; filename="core-em-levels.pine"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (!raw) return NextResponse.json({ error: "ticker required" }, { status: 400 });

    const cleaned = raw.replace(/[$]/g, "").replace(/^\//, "");
    const candidates = [ALIAS[raw], ALIAS[cleaned], raw, cleaned].filter(Boolean);

    const result = await pool.query(
      "SELECT * FROM ticker_levels WHERE ticker = ANY($1) LIMIT 1",
      [candidates]
    );
    if (!result.rows.length) {
      return NextResponse.json({ error: `no levels found for ${raw}` }, { status: 404 });
    }

    const pine = buildPine(result.rows[0] as Row);

    if (asJson) {
      return NextResponse.json({ ticker: raw, pine });
    }

    return new NextResponse(pine, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `inline; filename="${raw}-em-levels.pine"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/pinescript GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
