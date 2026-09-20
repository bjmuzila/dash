# Quick Links — board card reference

| | |
|---|---|
| **Catalog id** | `quick-links` |
| **Label** | `Quick Links` |
| **Icon** | 🔗 |
| **Default grid size** | `{ w: 16, h: 24 }` — a **third** of the board's 48 columns, 24 rows × `BOARD_ROW_H` (8px) = 192px |
| **Source folder** | None of its own. The whole card lives inside `src/board/catalog.tsx`. |
| **Loaded** | **Statically**, not `lazy()` |
| **Instance-aware** | No. `render: () => <QuickLinksCard />` |
| **On the default board** | **Yes.** `DEFAULT_IDS = ['gex-candles', 'key-levels', 'quick-links']` in `src/board/BoardPage.tsx`. |
| **Gallery blurb** | "A short list of links you keep, saved in this browser." |

---

## What it is, in one paragraph

Quick Links is a short editable list of URLs, stored in this browser and nowhere else. It reads no
feed, opens no socket, polls no endpoint and computes no number: every other card on this board
exists to put a live figure in front of you, and this one exists to put the broker tab, the
Discord channel and the earnings calendar one click away from the board you already have open. It
has two modes — a read mode that is nothing but a scrollable list of links, and an edit mode that
adds a remove button beside each one and a two-field form underneath. It is the only card in the
catalog that is a **static import**, because "it is a few lines and a chunk boundary would cost
more than it saves"; it is one of the three cards a fresh board opens with; and its entire state
is one `localStorage` array of `{ id, label, url }`.

---

## File map

Real line counts, `wc -l`, from `voltick-v3/`:

| File | Lines | What it owns |
|---|---:|---|
| `src/board/catalog.tsx` | 444 | Everything: `LINKS_KEY`, the `QuickLink` type, `loadLinks()`, `saveLinks()`, the `QuickLinksCard` component and the catalog entry. The card occupies lines 96–184 (helpers 98–117, component 119–184) plus the one-line catalog entry at line 326, in a file that is otherwise the board's card registry, the renamed-id migration table and the instance-id helpers. |
| `src/board/BoardPage.tsx` | 831 | `DEFAULT_IDS`, which puts this card on every new board. |
| `src/pages/CardGallery.tsx` | 315 | The one-line description in the "+ Add card" gallery. |
| `src/design/primitives/Card.tsx` | 238 | The surrounding plate, the one-row `h-8` header and the expand control. Quick Links renders no `CardToolbar`, so its header is title + expand button and nothing else. |
| `src/design/tokens.css` | 716 | Every colour. |

There is no `src/board/quickLinks/` directory, no settings module and no render module.

---

## The data path

**There isn't one.** No HTTP endpoint, no WebSocket frame, no poll cadence, no stale window, no
query param, no `useQuery` registration (so the toolbar's ↻ `refreshAll()` does not touch it), no
`useFrame` / `useField` / `watchFrame`, no `useTick`, no timers, no refs. The card mounts, reads
`localStorage` once, and then re-renders only in response to a click or a keystroke.

That absence is worth stating rather than omitting. Every other card in this catalog carries at
least one of the failure modes the other three documents spend pages on — a stale window, an
aggregate that can disagree with its own tape, a 200 that carries an error string, a socket that
streams one symbol while the card claims another. Quick Links has none of them. Its only failure
mode is storage.

---

## Storage

```ts
const LINKS_KEY = 'cb-v3-quick-links'
type QuickLink = { id: string; label: string; url: string }
```

**Shape on disk** — a JSON array of objects, with **no version field**, no wrapper and no schema
marker:

```json
[{ "id": "1758384000000-0", "label": "Broker", "url": "https://…" }]
```

### `loadLinks()`

```ts
function loadLinks(): QuickLink[] {
  try {
    const raw = localStorage.getItem(LINKS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
```

**What an old or bad stored value coerces to:**

| Stored | Result |
|---|---|
| nothing (`null`) or `""` | `[]` — falsy, so `JSON.parse` is never called |
| `"{}"`, `"null"`, `"42"`, `"\"hi\""` | `[]` — parses fine, fails `Array.isArray` |
| malformed JSON (`"[{"`) | `[]` — `JSON.parse` throws, the `catch` swallows it |
| an array of **anything at all** | **returned as-is** |

> ⚠ **The array's *contents* are not validated.** `Array.isArray(parsed)` is the entire check. A
> stored `[1, 2, 3]`, `[null]`, or objects carrying `href` where `url` should be all survive
> intact and reach the render: `l.label` renders empty, `href={undefined}`, and `key={l.id}`
> collides. Nothing throws. This is a deliberate trade — the card holds no derived state, so a
> corrupt entry costs one broken row rather than a broken board — but it is the one place this
> card differs in kind from `TopFlowCard.loadSettings()` and `FlowTapeCard.loadStop()`, both of
> which validate **every field on its own** against the current option list.

### `saveLinks()` and when it writes

```ts
function saveLinks(links: QuickLink[]) {
  try { localStorage.setItem(LINKS_KEY, JSON.stringify(links)) } catch { /* best-effort */ }
}

const [links, setLinks] = useState<QuickLink[]>(() => loadLinks())
useEffect(() => saveLinks(links), [links])
```

The state is read **lazily** in the `useState` initialiser — the same pattern `NetPremiumCard`'s
span and `FlowTapeCard`'s stop use, so the first paint is already on the stored value rather than
on a default an effect corrects a frame later.

`[links]` means the effect fires **on mount as well as on every change**. That mount write is a
no-op in content but not in effect: it normalises whatever was on disk into canonical
`JSON.stringify` output, and it means a browser where reading works but writing does not fails
silently at mount rather than at the moment someone adds a link.

### What happens when localStorage is blocked

Both helpers are wrapped, and for the reason `NetPremiumCard` spells out: in a locked-down browser
`localStorage` **throws outright on access**, it does not merely return `null`. Private mode,
blocked site data and a hardened enterprise profile all reach the `catch`.

| | |
|---|---|
| Read throws | `loadLinks()` returns `[]`, the card renders its empty state, everything else works |
| Write throws | swallowed. **The in-memory list still drives this session** — add, click and remove all work until the tab reloads. |
| Surfaced to the user | **nothing.** No toast, no warning, no dimmed state. |

That last row is a real divergence from the rest of the board: `FlowTapeCard` and `TopFlowCard`
swallow storage failures too, but their state is a preference the session recreates. Here the
state **is** the content.

---

## Controls and the edit flow

```ts
const [editing, setEditing] = useState(false)   // NOT persisted
const [label, setLabel] = useState('')          // draft label
const [url, setUrl] = useState('')              // draft URL
```

`editing` is deliberately not stored. Reopening the board always lands in read mode, which is the
mode the card is for.

**Read mode** — the scrollable list, and one button: **`Edit links`**
(`text-xs text-muted hover:text-fg`, `self-start shrink-0`).

**Edit mode** — every row grows a **`✕`** (`text-xs text-faint hover:text-down`,
`title="Remove link"`), and the footer becomes a form above a `border-t border-line pt-2` rule:

| Control | Type | Placeholder | Notes |
|---|---|---|---|
| Label | `<input>` | `Label` | `rounded-sm border border-line bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent` |
| URL | `<input>` | `https://…` | same classes. **A plain text input** — not `type="url"`, so the browser contributes no validation of its own. |
| **`Add`** | `<button>` | — | `rounded-sm bg-accent px-2 py-1 text-xs text-bg` — the one filled control on the card |
| **`Done`** | `<button>` | — | `text-muted hover:text-fg`; sets `editing = false` |

The two buttons sit in `flex justify-end gap-1`, so `Add` is the primary and `Done` reads as the
way out.

### `add()` — the whole of the validation

```ts
const add = () => {
  const l = label.trim()
  const u = url.trim()
  if (!l || !u) return
  setLinks((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, label: l, url: u }])
  setLabel(''); setUrl('')
}
```

| Rule | Behaviour |
|---|---|
| Both fields trimmed | leading/trailing whitespace stripped before storing |
| Either empty after trimming | **silent no-op** — no error, no shake, no message |
| URL scheme | **not checked.** `example.com` is accepted and becomes a **relative** href, resolving against the app's own origin |
| Duplicates / length | allowed / unbounded |
| Position | appended to the bottom, never prepended |
| On success | both fields clear, the form stays open, `editing` stays `true` — only `Done` closes it |

**The id** is `` `${Date.now()}-${prev.length}` ``: a millisecond timestamp plus the current list
length, the suffix distinguishing two links added inside the same millisecond. It is only ever a
React `key` and a `remove()` target, so unique is all it needs to be. Note it is **not** monotonic
across removals — delete the third of three and add another and the suffix is `-2` again, which is
the opposite of the rule `newInstanceId()` follows a few hundred lines down in the same file,
where counting *up* is what stops "removing card #2 and adding another" resurrecting the old name.

**`remove(id)`** is `setLinks(prev => prev.filter(x => x.id !== id))` — immediate, unconfirmed,
irreversible. The write follows on the next effect flush.

---

## Rendering

**DOM only.** No canvas, no SVG, no `ChartFrame`, no `lightweight-charts`, no `data-cb-layer`.
Non-negotiables 4, 5 and 6 (charts are imperative; a card nobody can see does not paint; every
canvas carries `data-cb-layer`) have nothing to bite on.

```
div  flex min-h-0 flex-1 flex-col gap-2
├─ div  flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto        ← the list
│  ├─ span (empty state)   |   one row per link:
│  └─ div  flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-raised
│     ├─ a  flex-1 truncate text-sm text-fg hover:underline
│     └─ button ✕            (edit mode only)
└─ div (edit form)   |   button "Edit links"                       ← shrink-0
```

`min-h-0` on both the outer column and the list is what lets `overflow-y-auto` actually scroll
inside a flex parent; without it the list grows and pushes the form out of the card. `shrink-0` on
the footer is the other half. `truncate` on the anchor keeps a long label from breaking the row at
a 16-column width.

The anchor is `target="_blank" rel="noreferrer"` — `noreferrer` implies `noopener` in every
browser this app targets, so the opened tab gets no `window.opener` handle back into the board.

### Colour tokens, with hex from `src/design/tokens.css`

| Token | Hex | Where |
|---|---|---|
| `--color-fg` | `#e7ece9` | the link label, the input text |
| `--color-muted` | `#e7ece9` | `Edit links`, `Done` |
| `--color-faint` | `#c0c5c3` | the empty-state line, the `✕` at rest |
| `--color-line` | `#1e2630` | the input borders and the form's top rule |
| `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` | row hover |
| `--color-bg` | `#0a0d10` | the input fills, **and the ink on the Add button** |
| `--color-accent` | `#2f6bff` | the Add button's fill, and the input's focus border |
| `--color-down` | `#ff6b7a` | the `✕` on hover |

Every one arrives as a Tailwind utility with no shade number (`text-fg`, `bg-raised`,
`border-line`, `focus:border-accent`, `hover:text-down`) — non-negotiable 1's requirement, since
Tailwind's own palette is not a hex and so slips past a hex scan, and it is exactly what made v2's
text come out grey. The card carries **no colour literal and no inline `style` at all**.

Type comes from the scale: `text-sm` (13) for a link label, `text-xs` (11) for the empty state,
the inputs and both buttons. Row padding is `px-1.5 py-1` — at `h: 24` (192px) the card holds
roughly eight rows before it scrolls. The form's four elements stack vertically (`flex-col gap-1`)
because at a third of the board width there is no room for two inputs on one line.

---

## Phone, expanded and replay behaviour

**Phone.** No phone variant, and no `ControlSize` at all — the card does not use
`design/primitives/Controls.tsx`. Its inputs are `py-1 text-xs`, well under the 34px touch target
`ControlSize: 'touch'` exists to provide. `useIsPhone()` routes to `src/mobile/`, which has no
board.

**Expanded.** `Card` draws the `⤢` because Quick Links has a title, so it *can* fill the page
column. Nothing about it changes when it does: the list gets taller, the form stays at the bottom,
and because expansion is a portal (the React tree does not move) the `editing` flag and both draft
fields survive. It is the least useful expand target on the board and it is not worth
special-casing — `expandable` defaults to `true` and the catalog does not override it.

**Replay.** None, and none conceivable — no time axis, no server data.

---

## Status and empty-state messages, verbatim

The card has exactly **one** message.

```jsx
{links.length === 0 && <span className="text-xs text-faint">No links yet — add one below.</span>}
```

Shown whenever the list is empty, in **both** modes. Note the consequence: on a fresh board — and
Quick Links is on every fresh board via `DEFAULT_IDS` — the card says "add one below" while the
only thing below it is the `Edit links` button, not the form. The instruction is one click short
of literal.

That is the complete inventory. No loading state (nothing loads), no error state (nothing can fail
loudly), no stale state, no `LIVE`/`WAITING`/`ERROR` badge, and no `.stale` wash — the card never
passes `stale` to `Card`.

**Every other string, verbatim:** `Edit links` (read mode footer) · `Label` (placeholder) ·
`https://…` (placeholder — a real ellipsis, not three dots) · `Add` · `Done` · `✕` ·
`Remove link` (the `title` on `✕`).

The card publishes **no `data-capture-meta`**, so `shell/snapshot.ts` falls back to the card's name
and the time: a shot captions as `Quick Links · Sep 20, 15:42 ET`, which is all its header would
have said anyway.

---

## How it differs from every other card

| | Quick Links | Every other card |
|---|---|---|
| Import | **static** | `lazy()`, so its code arrives when the card does |
| Own directory | **no** — lives inside `catalog.tsx` | `src/board/<name>/` |
| Data source | **none** | at least one endpoint, socket frame, or both |
| Polls | **none** | 5s – 60s |
| Derived numbers | **none** | the card's whole reason to exist |
| Canvas / `data-cb-layer` | **none** | most of them |
| `CardToolbar` | **not rendered** | almost all of them |
| Content is user-authored | **yes** | no — it is the market's |
| Failure mode | storage refused a write, silently | a feed stalled, an aggregate disagreed, a 200 carried an error |
| On the default board | **yes** | only `gex-candles` and `key-levels` |

The static import is written down in the catalog's own header:

> The big ones are `lazy()`. … Quick Links stays static — it is a few lines and a chunk boundary
> would cost more than it saves.

---

## Performance notes

Nothing to say, and that is the finding. The card renders `links.length` anchors and, in edit
mode, four extra elements. There is no `useMemo` and no `useCallback` anywhere in it, because
there is nothing expensive to memoise: `add` and `remove` are recreated every render and passed
only to DOM handlers, where identity does not matter.

The one write per state change is a synchronous `localStorage.setItem` of a tiny JSON string, on a
gesture, on the main thread — below measurement at the list sizes this card is for. A pathological
hand-injected list of thousands would re-serialise the lot on every add and remove, and would also
blow past the 5MB origin quota and start hitting the `catch`.

`scripts/perf-check.mjs` counts repaints per animation frame on canvases tagged `data-cb-layer`,
attributed per board card. Quick Links owns no canvas, so it contributes exactly `0` to every
number in `budgets.json`'s `perf` block.

---

## Gotchas

- **There are two components called `QuickLinksCard` in this repo, and they are unrelated.** This
  one (`src/board/catalog.tsx:119`) is the board card: free-text URLs, `{ id, label, url }`,
  `localStorage` under `cb-v3-quick-links`. The other (`src/pages/TradersDashboard.tsx:838`) is
  the Traders Dashboard's widget: a `<select>` of `ALL_PAGES` routes, `LinkItem { id, label, href }`,
  validated by `isLinkItem` / `isLinkArr`, and **saved to the server** through that page's
  `savePrefs`. Grepping for `QuickLinksCard` finds both; changing the wrong one is a silent no-op
  on the surface you were looking at.

- **`loadLinks()` validates the container, not the contents.** `Array.isArray(parsed)` is the
  whole check; anything inside reaches the render untouched.

- **`add()` fails silently.** An empty label *or* an empty URL makes the button do nothing at all
  — no message, no focus jump, no visual response. The two most likely mistakes both land here.

- **The URL is never checked.** No scheme test, no `new URL()` parse, and `type="text"` rather
  than `type="url"`, so the browser adds nothing either. `example.com` becomes a **relative**
  href and navigates inside the app.

- **The mount write is real.** `useEffect(…, [links])` fires on mount, so the card rewrites
  storage before anyone has touched it — which is why a read-only storage failure surfaces
  immediately rather than on first edit.

- **Storage failure is invisible.** In a browser that refuses writes the card works perfectly for
  the life of the tab and loses everything on reload, with nothing on screen having said so.

- **The empty state points below itself at a button, not a form.**

- **`✕` deletes immediately.** No confirm, no undo.

- **It is on `DEFAULT_IDS`.** Removing or renaming the `quick-links` catalog id without adding an
  entry to `RENAMED` would make every new board open with a silently dropped card — `BoardPage`
  drops any id the catalog does not know, which is right for a deleted card and wrong for a
  renamed one.

- **`defaultSize` is `{ w: 16, h: 24 }`, and 16 is a legal lane.** Widths snap to a third (16), a
  half (24) or the whole board (48) — see `laneWidths()` in `design/primitives/Board.tsx`. Any
  other width in a hand-edited layout is snapped on the way in.
