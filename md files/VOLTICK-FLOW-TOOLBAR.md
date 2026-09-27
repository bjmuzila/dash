# Voltick · Flow toolbars (proposed)

Proposal, 2026-09-26. Mocked up on voltick.cbedge.net/mockups → ⚡ Flow.
Old version: `web/src/pages/Flow.jsx`.

## Summary

| | Old | New |
|---|---|---|
| Tabs to choose from | 7 top + 5 sub + 2 dark pool | 4 tabs, each with a sub-switch |
| Controls in the toolbar | ~18 | 11 |
| Toolbar shapes | 8 (one per view) | 1 (same on every tab) |
| Places to set size | 3 | 1 |

## Page header

```
[⚡ Tape] [⟳ Patterns] [◉ Market] [◐ Dark Pool]            [⚑ 3 alerts ▾] [?]
         └ sub-switch appears when a tab has more than one view
```

| Tab | Sub-switch |
|---|---|
| ⚡ Tape | none (every print) |
| ⟳ Patterns | Repeated · 1162 · One-shots · Being built · Waking up |
| ◉ Market | Most active · Sectors · Net drift · Premium by expiry · OI changes |
| ◐ Dark Pool | Prints · Cross-confirm |

- **⚑ 3 alerts ▾** replaces the full-width Alerts Set bar.
- **?** starts the tour (was "▶ Show me around").

## Toolbar (same row on every tab)

```
[Ticker or contract · SPY 600C 10/2] [Stocks ▾] [All|▲ Bullish|▼ Bearish] |
[★ Unusual] [0DTE] [On a level] [My watchlist] [⚙ Filters · 2]      [Newest|Biggest] [● Live ▾]
[$250K+ ✕] [At ask ✕]  Clear          ← active filters, always visible
```

- **Search** takes a ticker **or** a contract (`SPY 600C 10/2`). Replaces the Find a contract row.
- **Stocks ▾**: Stocks · ETFs · All.
- **Direction**: one switch, All · Bullish · Bearish (was separate ▲ and ▼ chips).
- **Quick chips** that do not apply to a tab drop out rather than moving:
  Market shows only My watchlist; Dark Pool shows ★ Standout and On a level.
- **● Live ▾**: Live · ⏸ Pause the tape · past sessions (↺ Sep 24, …). Pause lives here now.
- Direction switch hidden on Market.

## ⚙ Filters drawer

```
Filters                                             ✕
SAVED  [★ Whales] [★ Big LEAPs] [★ Morning sweep]
THE CONTRACT   Type · Days out · Expiry ▾ · Price ▾
HOW BIG        Premium $50K+…$1M+ · Volume · Vol/OI · Open int
THE TRADE      Fill (at ask / at bid) · Shape (outright only, swept only) · Company (Mega…Small)
[Clear all]                                 [＋ Save as preset]
```

Chips inside the drawer light up when they are active above.

## Below the toolbar

- **Summary line**: `Net +$17.7M bought · 14,789 prints · 7% swept · Calls $692M · Puts $200M · Put/call 0.41 · two-sided   Details ▾`
  (was a 5-box stats strip; Details opens the full strip).
- Table headers per tab, e.g. Tape: Time · Symbol · Contract · Premium · Read · Fill · Size · Vol/OI · Level.

## What changed and why

| Change | Why |
|---|---|
| 7 top tabs + 5 sub-tabs → 4 tabs | Grouped by what you are looking for. |
| ⟳ Repeated · 1162 chip → Patterns tab badge | It was a tab pretending to be a filter. |
| ▲ and ▼ → one Direction switch | Both can never be on at once. |
| Size chips + Filters Size + preset chips → Filters › How big | One place to answer "how big". Market cap moves to Filters › The trade. |
| ⚙ Filters panel → grouped drawer | The contract · How big · The trade. |
| ★ Presets menu → inside Filters | Presets are saved filters. |
| Find a contract row → search box | Same field as a ticker. |
| Active filters → removable chips | Always visible, one ✕ away. |
| Stats strip → one summary line | Same numbers, one line. |
| Pause + Live ▾ → one Live menu | Both answer "which tape am I looking at". |
| Alerts bar → ⚑ pill | Still one click, no longer a full row. |
| ⌥ Outright only → Filters › The trade | Rarely used, still one click deep. |
| ◑ CB → Settings › Display | A preference, not a per-page control. |
