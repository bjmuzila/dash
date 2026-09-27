# Voltick · Account menu (proposed)

Proposal, 2026-09-26. Mocked up on voltick.cbedge.net/mockups → ◉ Account menu.
Old version: `web/src/AccountMenu.jsx` (the disc at the foot of the left rail, opens upward).

Rule: **the rail is where you go, this menu is about you.** Anything that is a
place to go is already in the rail or moves there.

## Summary

| | Old | New |
|---|---|---|
| Rows (member) | 16 | 8 |
| Sections | 4 | 3 |
| Rows that duplicate the rail | 3 | 0 |

## The menu

```
┌───────────────────────────────────┐
│ (B) member@example.com            │
│     [MEMBER]  Owner tools →       │  ← owner sees the link; free sees "Upgrade →"
│───────────────────────────────────│
│ ⚙  Settings                       │
│ ▭  Plan & billing                 │  ← members only
│ ✦  What's new                  3  │
│───────────────────────────────────│
│ ?  Help & support              1  │  → opens sub-menu
│ ◌  Suggest a feature              │
│ ⚇  Community    Discord · Affiliates
│ ‹› API & agents                   │  ← members only
│───────────────────────────────────│
│ ⇥  Sign out                       │
└───────────────────────────────────┘
```

### Help & support sub-menu

| Row | Sub-line |
|---|---|
| How to use Voltick | The walkthrough, page by page |
| Blog | Session write-ups |
| Contact support · 1 reply | Your open conversation |
| Start the tour | On the page you are on |

### Plan tag

| Account | Tag | Link beside it |
|---|---|---|
| Owner | OWNER (amber) | Owner tools → |
| Member | MEMBER (green) | none |
| Free | FREE | Upgrade → |

## Rail head

Search moves to the top of the rail: `⌕ Search  ⌘K`.

## What changed and why

| Change | Why |
|---|---|
| Search → rail head | It is how you go somewhere; ⌘K works from anywhere. |
| Trade Journal → removed here | Already in the rail under Yours. |
| How to use, Blog, Contact support → Help & support | One row, one badge, a four-item sub-menu. |
| Affiliates + Discord → Community | Two outside places behind one row. |
| API + Connect An Agent → API & agents | Same audience, one door. |
| Owner Dashboard tile → link beside the plan tag | Still one click, no longer a big tile. |
| Plan line → tag + Upgrade link | A free account sees how to change that where it is asked. |
