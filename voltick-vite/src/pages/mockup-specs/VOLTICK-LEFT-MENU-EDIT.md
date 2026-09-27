# Voltick · Edit the left menu in place

Proposal, 2026-09-26. Mocked up on voltick.cbedge.net/mockups → ☰ Settings (left column).

## The idea

Members customise the left menu **inside the menu itself**, not on a separate
Settings page. One small ✎ button sits beside Search at the top of the rail.
Pressing it puts the rail into edit mode. Pressing Done puts it back.

## Normal mode

```
┌──────────────────────────────┐
│ ⌕ Search            ⌘K   [✎] │  ← small edit button
│ ★ FAVOURITES                 │
│ ★ Flow                       │
│ ★ Chart                      │
│──────────────────────────────│
│ ▦ The Board                  │
│     Single                   │
│     Multi                    │
│     Chart               ★    │  ← a favourite also keeps its place
│ ...                          │
│──────────────────────────────│
│ (B) Account                  │
└──────────────────────────────┘
```

- Favourites sit at the top, under Search.
- Hidden pages and hidden shelves are simply not there.

## Edit mode (after ✎)

```
┌─────────────────────────────────────┐
│ ⌕ Search                        ⌘K  │
│ ☆ favourite · ↑↓ move · 👁 hide [Done]│
│ ★ FAVOURITES                        │
│ ★ Flow               [↑][↓][★]      │
│ ★ Chart              [↑][↓][★]      │
│─────────────────────────────────────│
│ ▦ The Board          [↑][↓][👁]     │  ← shelf controls
│     Single        [☆][↑][↓][👁]     │  ← page controls
│     Multi         [☆][↑][↓][👁]     │
│     W̶h̶e̶r̶e̶ ̶T̶o̶ ̶S̶t̶a̶r̶t̶  [☆][↑][↓][🚫] │  ← hidden: struck through, still editable
│ ...                                 │
│ 3 hidden                ↺ Reset menu│
└─────────────────────────────────────┘
```

| Control | Where | Does |
|---|---|---|
| ✎ | Next to Search | Enter edit mode |
| Done | Hint bar | Leave edit mode; hidden rows disappear |
| ☆ / ★ | Every page row | Add to / remove from Favourites (max 6) |
| ↑ ↓ | Every page row | Move the page within its shelf |
| ↑ ↓ | Every shelf header | Move the whole shelf |
| ↑ ↓ | Favourites | Reorder favourites |
| 👁 | Page row | Hide / show that page (hiding also unfavourites it) |
| 👁 | Shelf header | Hide / show the whole shelf |
| ↺ Reset menu | Rail foot | Back to the default menu |

Buttons are 20 × 20 px, outline style, same line as the label so the rail
only widens a little (196 → 236 px) while editing.

## What stays on the Settings page

Settings › Left menu keeps only:

- **Start with:** Everything · Trader essentials · Minimal (sets which pages start hidden)
- **Open Voltick on:** the page a new tab lands on (was Board › Default view)
- An **✎ Edit the menu** button that opens the same edit mode in the rail

## Rules

- Hidden pages stay reachable from ⌘K search and their own links. This only tidies the menu.
- Saved per device (same as the rail's collapsed/open state today).
- Shelves with one page (Flow, Track Record) show the page's own ☆ on the shelf row.
- The account disc at the foot of the rail is never hideable.
