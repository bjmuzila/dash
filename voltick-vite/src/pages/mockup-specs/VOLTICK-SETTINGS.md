# Voltick · Settings (proposed)

Proposal, 2026-09-26. Mocked up on voltick.cbedge.net/mockups → ☰ Settings.
Old version: `web/src/pages/Settings.jsx`.
Left-menu editing detail: see `VOLTICK-LEFT-MENU-EDIT.md`.

## Summary

| | Old | New |
|---|---|---|
| Places preferences live | 5+ (Settings, ◑ CB on pages, chart popover, board, Alerts) | 1 page (plus the ✎ in the rail) |
| Left-menu controls | none | ☆ favourite · ↑ ↓ · hide, right in the rail |
| Search | none | Search settings |

## Layout

```
[ rail with ✎ ] [ Search settings ] [ cards … ]
                [ Left menu       ]
                [ Chart           ]
                [ Flow            ]
                [ Display         ]
                [ Notifications   ]
                [ Account & plan  ]
```

One page of cards, not tabs. Typing in **Search settings** leaves only the
matching cards (e.g. "watermark", "billing").

## Cards

### Left menu
- **✎ Edit the menu** (opens edit mode in the rail itself)
- **Start with:** Everything · Trader essentials · Minimal
- **Open Voltick on:** Single board ▾ (was Your board › Default view)

### Chart
- **Preset:** Full · Calm · Minimal (the defaults every chart opens with)
- **Layers and studies:** Open ⚙ Chart settings (same panel as the chart button)

### Flow
- **Open on:** Tape · Patterns · Market · Dark Pool
- **Universe:** Stocks · ETFs · All
- **Start with preset:** None ▾ (your saved filters)

### Display
- **Colour-blind palette** (was the ◑ CB button on each page)
- **Hover tips**
- **Plain-English ribbon**
- **Compact rows** (tighter tables on Flow and the scanner)

### Notifications
Where alerts reach you. Which alerts fire lives on the Alerts page.
- **Push on this device**
- **Morning brief email**
- **Your alerts:** Open Alerts →
  ("Big moves on your starred boards" and "The daily money leaning card" move to the Alerts page)

### Account & plan
- Email · Password (Change) · Plan (Manage billing) · Delete account…

## What changed and why

| Change | Why |
|---|---|
| Sections in one scroll → cards with a jump list + search | Nothing hidden behind a tab you did not open. |
| Search settings | Type a word, only the matching card stays. |
| Left menu: nothing → edit right in the rail | Favourite, reorder and hide without leaving the page. |
| Start with presets | A starting point instead of 27 switches. |
| Default view → Open Voltick on | It is a question about where you land. |
| New Chart and Flow cards | Defaults live here; the chart button changes the one on screen. |
| ◑ CB → Display | One switch for every page instead of a button on each. |
| Two agent switches → Alerts page | Notifications say where, Alerts say what. |
