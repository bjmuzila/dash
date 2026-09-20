# `/feedback` — support tickets

**Route:** `/feedback` inside the SPA, `https://voltick.cbedge.net/v3/feedback` on
the wire (`BrowserRouter basename="/v3"`).
**Mounted by:** `const Feedback = lazy(() => import('@/pages/Feedback'))` →
`<Route path="/feedback" element={<Feedback />} />` in `src/App.tsx`.
**Reached from:** the account menu, top right of the toolbar — two rows in
`src/shell/UserMenu.tsx`. **Deliberately not in the rail.**

**Sources**

| Path | Role |
|---|---|
| `src/pages/Feedback.tsx` | the route: tabs, list, new-ticket form, the four fetches |
| `src/pages/feedback/Thread.tsx` | one conversation — bubbles, composer, chips, the attachment tray |
| `src/pages/feedback/shots.ts` | screenshot capture, downscale and the wire format |
| `src/shell/UserMenu.tsx` | the two doors into this page, and the unread badge on the avatar |
| `src/App.tsx` | the `lazy()` route and the note on why it is *not* a rail entry |
| `src/design/primitives/Controls.tsx` | `SegGroup` — the tab switch and the category switch |
| `src/design/tokens.css` | every colour |

---

## What it is, in one paragraph

Sending feedback here is not fire-and-forget. Every submission opens a **ticket
the customer keeps**: it lands `Open`, both sides trade replies on it, and it
closes only when CB Edge marks it complete — and a customer reply on a closed
ticket reopens it, which **the server does, not this page**. The route is two
views over one card: **New** (a category switch, a textarea and an attachment
tray) and **My tickets** (a list, and a full thread when one is picked). It was
ported from the Next page at `/feedback` on 2026-09-09 and that page still
exists — it is what the v2 wing's account menu links to — so this is a *second*
front end onto the same `/api/feedback` routes, exactly as the owner inbox at
`owner.cbedge.net` is a third. REST plus a 15-second poll on an open thread; no
socket, no canvas: a support thread moves at human speed.

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/pages/Feedback.tsx` | 388 | `THREAD_POLL_MS`, tab/ticket query-string state, `loadList`, `loadThread`, `submit`, `reply`, the three card bodies |
| `src/pages/feedback/Thread.tsx` | 561 | `FeedbackTicket` / `FeedbackMessage` types, `CATEGORY_LABEL` / `CATEGORY_OPTIONS`, `num`, `fmtWhen`, `fmtStamp`, `StatusChip`, `UnreadDot`, `Lightbox`, `ShotGallery`, `ShotTray`, `useShotDrop`, `Bubble`, `FIELD`, `SEND_BTN`, `Thread` |
| `src/pages/feedback/shots.ts` | 167 | `FeedbackShot`, `PendingShot`, `MAX_SHOTS`, `SHOT_MAX_PX`, `PNG_KEEP_BYTES`, `SHOT_ACCEPT`, `shotUrl`, `shotKb`, `prepareShot`, `prepareShots`, `imageFilesFrom` |
| `src/shell/UserMenu.tsx` | 300 | `FEEDBACK_PATH`, `TICKETS_PATH`, `TICKET_POLL_MS`, `loadUnread`, the avatar dot, the two navigating rows |
| `src/App.tsx` | 249 | the `lazy()` binding and the "one deliberate departure from the four-step rule" note |
| `src/design/primitives/Card.tsx` | 238 | the plate; all three cards pass `expandable={false}` |
| `src/design/primitives/Page.tsx` | 38 | `<main>`, the `h1`, the `actions` slot the tab switch sits in |
| `src/design/primitives/Controls.tsx` | 647 | `SegGroup` (`size` defaults to `'sm'` → `px-1.5 py-0.5 text-2xs`) |

---

## Why it is not in the rail

From `src/App.tsx`, at the `lazy()` binding — this is the only place in the app
where the four-step "Adding a page" rule is knowingly broken:

> `/feedback` — support tickets, ported from the Next page at `/feedback` on
> 2026-09-09. **NOT IN THE RAIL**, and that is the one deliberate departure from
> the four-step rule below: the rail is trading surfaces, and support is reached
> the way it always was, from the account menu (`shell/UserMenu.tsx`, which now
> points at `/v3/feedback` rather than out to the Next page). An icon for it
> would push a working destination out of the rail to save a customer one click
> a quarter.
>
> The Next page stays where it is — it is what the v2 wing's account menu links
> to — so this is a second front end on the same `/api/feedback` routes, exactly
> like the owner inbox is a third.

Step 4 (`app/v3/feedback/route.ts` calling `serveSpaShell("v3")`) still applies:
without it a hard refresh or a pasted `?ticket=` link 404s. The badge in the
account menu links straight into the query string, so that handler is
load-bearing.

One consequence: `src/data/pageVisit.ts`'s `labelFor()` searches `NAV` and then
`MOBILE_TABS`, and `/feedback` is in neither — so this route logs to
`page_visits` under the raw path `"/feedback"`, not a human label. The comment
in that file names it explicitly: "A route in neither (`/feedback` is
deliberately out of the rail; `/legacy` moves around) falls back to its own
path, which is ugly in the log but never wrong."

---

## How it is reached — `UserMenu.tsx`

Three constants: `FEEDBACK_PATH = '/feedback'` ("In-SPA paths — no `/v3` prefix,
the router's basename supplies it"), `TICKETS_PATH = '/feedback?tab=mine'`
("Deep-links straight to the ticket list rather than the new-ticket form") and
`TICKET_POLL_MS = 60_000`.

Two rows, near the bottom of the dropdown, under a `Divider`:

| Row | Target | Behaviour |
|---|---|---|
| **My Tickets** | `/feedback?tab=mine` | `goFeedback(TICKETS_PATH)` — closes the menu, then `navigate()` |
| **Feedback & Support** | `/feedback` | `goFeedback(FEEDBACK_PATH)` — same |

`goFeedback` calls `setOpen(false)` and then `navigate(to)` — "Both close the
menu first — a route change under an open dropdown leaves it hanging over the
page it just navigated to."

### These two rows are the file's only exceptions to its own rule

`UserMenu.tsx`'s header is emphatic about native anchors:

> **Almost every link is a NATIVE `<a>`, on purpose.** v3's router runs with
> `basename="/v3"`. A `<NavLink to="/docs">` would resolve to `/v3/docs` — which
> is not a v3 route and, by `App.tsx`'s no-catch-all rule, would render
> `NotFound` rather than the real Next page. […] This is the exact bug v2's
> `UserMenu` carries three separate comments about.
>
> **THE TWO EXCEPTIONS ARE FEEDBACK.** `/feedback` was ported into v3 on
> 2026-09-09 […] a native `<a href="/v3/feedback">` would be a full document
> load that reboots the whole SPA to reach a page that is already in the bundle.
> Those two rows navigate. Everything else in this file still leaves.

The remaining `INFO_LINKS` (`/docs`, `/disclaimer`, `/risk-disclosure`,
`/terms`, `/privacy`), plus `/guide` and `/whats-new`, are all still native
anchors to Next routes.

### The unread badge

`UserMenu` runs its **own** poll, separate from anything the page does:

`loadUnread` fetches `/api/feedback?scope=mine&limit=1` with
`cache: 'no-store'` and `credentials: 'same-origin'`, returns early on a
non-`ok` response — "signed out / not provisioned — leave the badge dark" — and
otherwise coerces `unreadCount` through `Number(… ?? 0)` and keeps it only if
finite and positive.

- `limit=1` because only `unreadCount` is read; the items are thrown away.
- **60s cadence**, visibility-gated — "A background tab is nobody looking at a
  badge — skip the query and catch up on the way back, so a parked dashboard is
  not a query a minute." `document.addEventListener('visibilitychange', tick)`
  snaps it current on return.
- **Refreshed on open**: "Opening the menu is the one moment the number is
  actually read — refresh it then, so it is never a minute stale at the moment
  it matters."
- `user` null → `setUnread(0)` and no poll at all.
- Every failure path is swallowed: "the badge is a nicety — never let it surface
  an error."

Three places it shows:

1. **The avatar's border** turns `border-warn` from `border-line` when
   `unread > 0`.
2. **A dot on the avatar**, `absolute -right-0.5 -top-0.5 h-2.5 w-2.5
   rounded-full border-2 border-bg bg-warn`, `pointer-events-none`,
   `aria-hidden`. Comment: "The 'light up': a dot on the avatar itself, so an
   unread reply is visible without opening the menu. The count lives on the row
   inside."
3. **The My Tickets row** gains `bg-raised font-bold text-warn` and a pill
   showing the count, capped at `99+`.

The avatar `title` also changes: `` `${unread} unread ticket ${unread === 1 ? 'reply' : 'replies'}` ``
instead of the email.

---

## The data path

Everything is a raw `fetch` with `cache: 'no-store'` and
`credentials: 'same-origin'`. Nothing on this route goes through
`src/data/api.ts` (`useQuery` / `query` / `preload`) and nothing touches the
socket. There is no stale window, no dedupe and no cache — a support thread is
read once and polled, and `no-store` is what stops a browser serving a reply
that already landed from its own cache.

### Endpoints

| Method + URL | Called from | When | Response |
|---|---|---|---|
| `GET /api/feedback?scope=mine` | `Feedback.loadList` | on mount; after `submit`; after `reply`; on "← All tickets" | `{ items: FeedbackTicket[], unreadCount: number \| string }` |
| `GET /api/feedback?scope=mine&limit=1` | `UserMenu.loadUnread` | on sign-in, every 60s visible, on menu open | `{ unreadCount: number \| string }` |
| `GET /api/feedback/:id` | `Feedback.loadThread` | when `?ticket=` is set, then every 15s visible | `{ ticket, messages, shots, isOwner, isAuthor }` |
| `POST /api/feedback` | `Feedback.submit` | "Open a ticket" | `{ id }` or `{ feedback: { id } }` |
| `POST /api/feedback/:id/messages` | `Feedback.reply` | "Send" in a thread | (body ignored on success) |
| `GET /api/feedback/shot/:id?v=<etag>` | `shotUrl()`, as an `<img src>` | rendering any attachment | image bytes |

Nothing here takes a page, a cursor or a date. The only query parameters in the
whole surface are `scope`, `limit` and `v` (the ETag cache-buster).

### `scope=mine`, always

> **SCOPE=MINE, ALWAYS.** This page is "my tickets". Without that parameter the
> OWNER opening their own support page gets the entire customer queue rendered
> as if they had written every word of it; the inbox is a different surface
> (`owner.cbedge.net`).

Both `loadList` and `loadUnread` hardcode it. There is no code path on this
route that omits it.

### Poll cadences

| Poll | Constant | Gate |
|---|---|---|
| Open thread | `THREAD_POLL_MS = 15_000` (`Feedback.tsx`) | `if (!document.hidden)` inside the interval; interval cleared when `openId` changes or the route unmounts |
| Account-menu badge | `TICKET_POLL_MS = 60_000` (`UserMenu.tsx`) | `if (!document.hidden)`, plus a `visibilitychange` listener |
| Ticket **list** | *none* | refetched only on mount, after send, after reply, and on "← All tickets" |

The thread poll's reason, verbatim: "An open thread is polled — an owner reply
should land without a refresh."

### Request bodies

**New ticket:**

```ts
body: JSON.stringify({
  category,                       // 'bug' | 'idea' | 'note' | 'other'
  message: msg,                   // trimmed
  page: '/v3/feedback',           // literal, see Gotchas
  shots: shots.map((s) => ({ dataUrl: s.dataUrl, name: s.name })),
})
```

**Reply:** `{ message: text, shots: replyShots.map(s => ({ dataUrl, name })) }`.

Both send `content-type: application/json`. The wire format for images is a data
URL inside the ordinary JSON body — from `shots.ts`:

> The wire format is a data URL inside the ordinary JSON body — `shots:
> [{dataUrl,name}]` on `POST /api/feedback` and `POST /api/feedback/:id/messages`
> — because `server-v2` has no multipart parser and never needed one (the recipe
> photo path makes the same trade).

### Response shapes

```ts
export type FeedbackStatus = 'open' | 'resolved'

export interface FeedbackTicket {
  id: number
  clerk_user_id: string | null
  email: string | null
  category: string
  message: string                 // the OPENING message; there is no subject line
  page: string | null
  status: FeedbackStatus
  created_at: string
  updated_at: string
  reply_count: number | string
  last_activity_at: string
  unread_user: number | string
  unread_owner: number | string
  /** Attachments across the whole ticket — the 📎 hint on a list row. */
  shot_count?: number | string
}

export interface FeedbackMessage {
  id: number
  author: 'user' | 'owner'
  body: string
  created_at: string
}

```

`FeedbackShot` (in `shots.ts`) is `{ id, message_id: number | null, author,
mime, byte_len: number | string, etag, name: string | null, created_at }` —
"never the bytes". `message_id === null` means "attached to the ticket's opening
message".

The `number | string` unions are not sloppiness:

> A ticket row as `/api/feedback` returns it. COUNT comes back from Postgres as
> a string (bigint, and node-postgres does not narrow it) — hence
> `number | string` and `num()`. **Never do arithmetic on these raw.**

```ts
export function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
```

Every read of `reply_count`, `shot_count`, `unread_user` and `unreadCount` goes
through it.

### Failure behaviour

Deliberately quiet on reads, loud on writes.

| Path | On failure |
|---|---|
| `loadList` | swallowed — "the list is a convenience — a failure here must not block sending". `listLoaded` is still set true in `finally`, so the empty-state message appears rather than a spinner forever |
| `loadThread` | swallowed — "keep whatever is already on screen" |
| `loadUnread` | swallowed, badge stays dark; a non-`ok` response returns early before parsing |
| `submit` | reads `{ error }` off the body if it parses, else `` `Failed (${res.status})` ``; falls back to `'Something went wrong.'` |
| `reply` | same shape; falls back to `'Reply failed.'` |

There is also a **stale-response guard** on the thread: `openIdRef.current` is
assigned every render, and `loadThread` bails with
`if (openIdRef.current !== id || !j.ticket) return` — "moved on while in flight".
A 15s poll for ticket 12 that lands after you have opened ticket 13 is dropped.

---

## Controls

| Control | Where | What it does | Default | State lives in |
|---|---|---|---|---|
| **Tab switch** `✍ New` / `📬 My tickets (n)` | `Page` `actions` | swaps the card body | `new` | query string `?tab=` |
| **Ticket row** (whole row is a `<button>`) | My tickets card | opens the thread | — | query string `?ticket=` |
| **← All tickets** | thread header | clears `?ticket` and reloads the list | — | query string |
| **Category** `🐞 Bug` `💡 Idea` `📝 Note` `💬 Other` | new-ticket card | sets `category` on the POST | `'note'` | component state only — **not** persisted, **not** in the URL |
| **Message textarea** | new-ticket card | `rows={7}`, `maxLength={5000}` | `''` | component state |
| **📎 Screenshot** / paste / drag | both composers | queues a `PendingShot` | empty | component state (two independent queues) |
| **Open a ticket** | new-ticket card | `POST /api/feedback` | disabled while `submitting` | server |
| **Reply textarea** | thread | `rows={3}`, `maxLength={5000}`, Enter sends | `''` | component state, reset on `ticket.id` change |
| **Send** | thread | `POST /api/feedback/:id/messages` | disabled unless `canSend` | server |
| **Mark complete / Reopen** | thread | — | **not rendered here** | server (owner surface only) |
| **Attachment thumbnail** | thread | opens the `Lightbox` | closed | component state |

**Nothing on this route writes to `localStorage` or `sessionStorage`.** All
shareable state is the query string; everything else is component state that
dies with the route.

### The query string

```ts
const openId = Number(params.get('ticket') ?? 0) || null
const tab: Tab = params.get('tab') === 'mine' || openId ? 'mine' : 'new'
```

- `?ticket=12` alone is enough to land on the thread — `tab` is derived, so
  `?tab=new&ticket=12` still shows the thread.
- `Number('abc') || null` → `null`, and `?ticket=0` → `null`. Garbage degrades to
  the list rather than to an error.
- Every write goes through `go({ tab?, ticket? })`, which copies the existing
  params, sets `tab` when given, sets `ticket` when truthy and deletes it on an
  explicit `null`, then calls `setParams(p, { replace: true })`.

From the page header: "`?tab=mine` and `?ticket=<id>` are the deep links the
account menu and the unread badge use, and they live in the query string so a
link to a ticket is shareable and Back works." And from `App.tsx`: "The tab and
the open ticket live in the query string, so `/v3/feedback?tab=mine&ticket=12`
is a real link — which is what the account menu's unread badge points at."

Note the tension: `replace: true` means Back does **not** step through tab
switches or ticket opens — it leaves the page. See Gotchas.

---

## Screen 1 — New ticket

Card title **"Open a ticket"**, `expandable={false}`. The whole card body
carries `{...dropHandlers}` from `useShotDrop`, so a paste or a drop anywhere on
it queues an image.

```
<div class="flex flex-col gap-3">                       ← drop target
  Type  [🐞 Bug] [💡 Idea] [📝 Note] [💬 Other]        ← SegGroup, label text-2xs uppercase text-faint
  <textarea rows=7 maxLength=5000 class={FIELD + ' resize-y font-sans leading-relaxed'} />
  <span class="text-right text-2xs text-faint">{message.length}/5000</span>
  <ShotTray … />
  <div class="flex justify-end"><button class={SEND_BTN}>Open a ticket</button></div>
</div>
```

`FIELD` and `SEND_BTN` are exported from `Thread.tsx` so the two composers
cannot drift. `FIELD` is
`w-full rounded-sm border border-line bg-bg px-2 py-1.5 text-sm text-fg outline-none placeholder:text-faint placeholder:opacity-40 focus:border-accent`;
`SEND_BTN` is
`rounded-sm border border-accent px-4 py-1.5 text-2xs font-bold uppercase tracking-wide text-accent transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-30`.

`dragOver` adds `border-accent` to the textarea only:

> The drop target is the whole block, so say so on the part the cursor is
> actually over.

### Submitting

The guard is `if (!msg && shots.length === 0)` → `'Write a message or attach a
screenshot first.'`, because "A screenshot on its own is a perfectly good ticket
— the server takes it and titles the row — so words are only required when
nothing is attached."

On success: `setMessage('')`, `setShots([])`, `await loadList()`, then
`go({ tab: 'mine', ticket: Number(j?.id ?? j?.feedback?.id ?? 0) || null })` —
"Drop straight into the ticket that was just opened — that IS the confirmation,
and it shows where the reply will arrive."

Two id shapes are accepted (`{ id }` and `{ feedback: { id } }`) because the
server has answered both over the life of the route. If neither parses, the user
lands on the **list** instead of the thread — still correct, just less direct.

There is **no success toast**. Landing in the thread is the confirmation.

---

## Screen 2 — My tickets (the list)

Card title **"My tickets"**. Rendered only when `tab === 'mine' && openId == null`.

One row per ticket, a `<button>` with this layout:

| Slot | Class | Content |
|---|---|---|
| category | `shrink-0 text-xs` | `CATEGORY_LABEL[t.category] ?? t.category` |
| subject | `min-w-0 flex-1 truncate text-sm text-fg` | `t.message` — the opening message *is* the title |
| attachments | `tabular shrink-0 text-2xs text-faint` | `📎 {num(t.shot_count)}` — hidden at 0 |
| replies | `tabular shrink-0 text-2xs text-faint` | `💬 {num(t.reply_count)}` — hidden at 0 |
| unread | — | `<UnreadDot count={num(t.unread_user)} />` — renders `null` at ≤0 |
| status | — | `<StatusChip status={t.status} />` |
| when | `tabular w-16 shrink-0 text-right text-2xs text-faint` | `fmtWhen(t.last_activity_at)` |

Row plate: `rounded-md border border-line bg-surface2 px-3 py-2 … hover:bg-raised`
— the same plate `/legacy` uses for its link rows, which is what makes the two
pages look like the same app.

`CATEGORY_LABEL` is a `Record<string, string>` with a `?? t.category` fallback,
so a category the server invents later renders its raw key rather than blank.

### `fmtWhen` — the list column

`< 1 min` → `just now`; `< 60 min` → `3m ago`; `< 24 h` → `5h ago`; exactly one
day → `yesterday`; `< 7 days` → `4d ago`; otherwise `Aug 12`
(`toLocaleDateString('en-US', { month:'short', day:'numeric' })`).

Empty string for a null/unparseable timestamp. `w-16` (64px) is the fixed slot —
"short enough for a list row".

### `StatusChip`

```ts
const open = status !== 'resolved'
```

| State | Text | Border + ink | Background |
|---|---|---|---|
| `open` (or anything not `'resolved'`) | **Open** | `border-warn text-warn` → `--color-warn` `#ffd166` | `alpha(T.orange, 0.12)` → `color-mix(in srgb, var(--color-warn) 12%, transparent)` |
| `'resolved'` | **Complete** | `border-accent text-accent` → `--color-accent` `#2f6bff` | `alpha(T.cyan, 0.12)` |

`rounded-full border px-2 py-0.5 text-3xs font-extrabold uppercase tracking-wide`,
`shrink-0 whitespace-nowrap`. The chip says "Complete", not "Resolved" — the
wire value is `resolved`, the customer-facing word is not.

### `UnreadDot`

```ts
if (count <= 0) return null
```

`tabular inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full
bg-warn px-1.5 text-2xs font-extrabold text-bg`, and `count > 99 ? '99+' : count`.
16px tall, ink is `--color-bg` `#0a0d10` on `--color-warn` `#ffd166` — the one
place on this page where dark ink sits on a solid fill.

---

## Screen 3 — one thread

Card title `` `Ticket #${thread.ticket.id}` `` once loaded, **"Ticket"** while
`thread` is null. Rendered when `tab === 'mine' && openId != null`.

`Feedback.tsx` supplies the `header` slot; `Thread.tsx` draws everything else.

### The header slot

`flex flex-wrap items-center gap-2 border-b border-line pb-2`, holding:
**← All tickets** (a `text-2xs uppercase text-faint` button that calls
`go({tab:'mine', ticket:null})` *and* `loadList()`), the category label at
`text-sm font-semibold text-fg`, `opened {fmtStamp(created_at)}` at
`text-xs text-faint`, and the `StatusChip` pushed right with `ml-auto`.

`fmtStamp` is the long form — `toLocaleString('en-US', { month:'short',
day:'numeric', hour:'numeric', minute:'2-digit' })` → `"Sep 9, 4:32 PM"`.

### The conversation

```
<div class="flex h-96 flex-col gap-3 overflow-y-auto rounded-md p-1
            [ring-1 ring-accent when dragging over]">
```

Fixed `h-96` (384px), scrolls internally. An effect jumps to the bottom whenever
the thread grows or is swapped:

```ts
useEffect(() => {
  endRef.current?.scrollIntoView({ block: 'end' })
}, [ticket.id, messages.length, shots.length])
```

The **opening message is not a `FeedbackMessage`** — it is the ticket row — but
it takes the same seat:

> The opening message is the ticket row itself, not a thread row — but it is
> always a CUSTOMER message, so it takes the same seat.

Its attachments are the ones with `message_id == null`:

```ts
// message_id NULL belongs to the opening message (a ticket row, not a message).
const shotsFor = (messageId: number | null) =>
  shots.filter((s) => (messageId == null ? s.message_id == null : s.message_id === messageId))
```

### `isOwner` vs `isAuthor` — the four combinations

This is the part of the file most likely to be "simplified" wrongly.

> **"MINE" IS WHICHEVER SIDE IS LOOKING**, and it is decided by `isAuthor` — did
> the VIEWER open this ticket — never by which page is rendering. `isOwner` and
> `isAuthor` are different questions and all four combinations happen: the owner
> reading a customer's ticket is not its author, and the owner reading one they
> opened themselves is both. **Both flags come from the server**, because only it
> knows who the caller is.

```ts
const isMine  = (author: 'user' | 'owner') => (isAuthor ? author === 'user' : author === 'owner')
const whoSaid = (author: 'user' | 'owner') => {
  if (author === 'user') return isAuthor ? 'You' : ticket.email || 'Customer'
  return isOwner && !isAuthor ? 'You' : 'CB Edge'
}
```

> Authoring the ticket wins over being staff: on your own ticket your
> customer-side words are "You", even when you are also who answers tickets.

| Viewer | `user` messages | `owner` messages |
|---|---|---|
| customer (author) | "You", right-aligned | "CB Edge", left |
| owner reading a customer ticket | the ticket's `email` (or "Customer"), left | "You", right |
| owner reading their own ticket | "You", right | "CB Edge", left |

`isOwner` changes exactly two things on this page: the composer placeholder, and
the label on staff replies. Everything about who *may* reply or close is the
server's call.

### A bubble

A column, `items-end` when mine and `items-start` otherwise: the body in a
`max-w-[88%] whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-sm
leading-relaxed text-fg` block, then the `ShotGallery`, then
`{who} · {when}` at `text-2xs text-faint`.

> A screenshot-only message gets NO bubble — an empty one reads as a bug, and
> the image is the message.

So `body ? <div…> : null`. The gallery and the `who · when` line still render.

Colours: mine is `border-accent` (`#2f6bff`) over
`color-mix(in srgb, var(--color-accent) 14%, transparent)`; theirs is
`border-line` (`#1e2630`) over `bg-surface2` (`#141a21`). Both inks are
`text-fg` (`#e7ece9`). `max-w-[88%]` on both the bubble and the gallery keeps a
long line from running the card's full width.

### The composer

A `rows={3}` `maxLength={5000}` textarea on `FIELD`, placeholder
`'Reply to this customer…'` for the owner and `'Add to this ticket…'` for
everyone else; then the `ShotTray`, a `text-xs font-semibold text-down` error
line, and a footer row carrying the keyboard hint on the left and `Send` on the
right.

```ts
onKeyDown={(e) => {
  // Enter sends, Shift+Enter breaks the line.
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
}}
```

`canSend = Boolean(draft.trim()) || pending.length > 0` — a screenshot with no
words is a valid reply, "and the composer says so by enabling Send."

`send()` clears the draft, the queue and the error **before** awaiting
`onSend`, so the box is empty the instant you hit Enter. A failed reply
therefore surfaces the error at page level but does **not** restore the text.

The left-hand slot is a ternary: if `onSetStatus` is supplied the Mark
complete / Reopen button goes there, otherwise the keyboard hint does.
`Feedback.tsx` never passes `onSetStatus`, so the customer always sees the hint
and never a close control. From the prop doc: "Owner-only. Omit to hide the
status control entirely."

When the ticket is closed and the viewer is not the owner:

> This ticket is marked complete. Replying reopens it.

`text-xs text-muted`, between the scroll region and the composer. The reopen
itself is the server's, per the page header: "A customer reply on a closed
ticket reopens it — the SERVER does that, not this page."

---

## Attachments — `shots.ts`

### Constants

```ts
/** The server caps this too; the number here is what makes the message honest. */
export const MAX_SHOTS = 6
/** Longest edge after downscaling. 1600 keeps UI text readable at 1:1. */
export const SHOT_MAX_PX = 1600
/** Under this, a PNG ships as-is rather than being re-encoded. */
export const PNG_KEEP_BYTES = 400 * 1024
export const SHOT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
```

### Why the browser does the resizing

> That puts SIZE on this side. A raw 4K screenshot is 6-8MB and base64 inflates
> it by a third; downscaled to 1600px and re-encoded it is a couple of hundred
> KB, which is the difference between a reply that sends on a phone and one that
> times out. `prepareShot` is the only thing that should ever build a data URL
> for this API.

### `prepareShot` — the decision tree

1. Not `image/*` → throw `` `${file.name || 'That file'} isn't an image.` ``
2. `FileReader.readAsDataURL` → throw `'Could not read that file.'` on error
3. **GIF passes through whole** — "A canvas would flatten an animated GIF to one
   frame, so it passes through whole." Over 5MB → `'That GIF is too big — 5MB max.'`
4. `loadImage` → throw `"That file isn't an image we can read."` on error
5. `scale = min(1, 1600 / max(naturalWidth, naturalHeight))`
6. **Small PNGs are kept as-is**: `scale === 1 && type === 'image/png' && size <= 400KB`
   returns the original data URL. Reason: "A cropped screenshot of TEXT goes to
   mush in JPEG at any bearable quality, and re-encoding a 300KB crop buys
   nothing. Only images that are actually large get re-encoded, where the win is
   real and the content is a whole screen rather than a few glyphs."
7. Otherwise: canvas at the scaled size, no 2D context → `"Your browser wouldn't
   let us resize that image."`
8. **The mat.** A transparent PNG flattened onto a JPEG gets a black mat by
   default; these are screenshots of a dark UI, so the canvas is pre-filled with
   `getComputedStyle(document.documentElement).getPropertyValue('--color-bg')` —
   read off the token, never typed. "No token, no mat: black is a fine last
   resort and is what the encoder would have done anyway, so there is nothing to
   hardcode here."
9. `canvas.toDataURL('image/jpeg', 0.9)` — "0.9 rather than the usual 0.8: this
   is a picture of TEXT, and ringing around small glyphs is what makes a bug
   report unreadable."
10. Byte estimate `Math.round((out.length - out.indexOf(',') - 1) * 0.75)`; over
    5MB → `'That image is too big even after resizing.'`

`prepareShots(files, already)` takes `room = MAX_SHOTS - already`, throws
`` `Up to ${MAX_SHOTS} images per message.` `` when `room <= 0`, slices to
`room`, and **throws on the first bad file** — see Gotchas.

`imageFilesFrom(dt)` reads `dt.files` first, then falls back to `dt.items`
because "A clipboard screenshot arrives as an ITEM rather than a file in some
browsers, and with no name — hence the fallback and the default above" (the
default being `'screenshot.png'` in `prepareShot`).

### `ShotTray`

A `📎 Screenshot` button (label `Adding…` while busy; disabled when
`disabled || busy || full`), then the queued thumbnails at `h-16 w-24
object-cover`, then — only while the queue is empty — the hint
`or paste / drag an image in`.

The remove button is `absolute -right-1.5 -top-1.5 rounded-full border
border-down bg-surface px-1.5 text-xs font-bold text-down` — a `✕` in
`--color-down` `#ff6b7a`.

> The queue lives in the PARENT, because whoever owns the Send button is what
> has to clear it once the message is away — and on this page that is the
> new-ticket form as often as it is a thread.

The file input is `hidden`, `multiple`, `accept={SHOT_ACCEPT}`, and resets
`e.target.value = ''` after each pick "so the same file can be picked twice".

When more files are dropped than there is room for:

> Only 6 images per message — the rest were skipped.

### `ShotGallery` and `Lightbox`

Thumbnails: `h-20 w-32 rounded-sm border border-line bg-surface2 object-cover`,
wrapped in a `cursor-zoom-in` button whose `title` is
`` `${s.name || 'screenshot'} · ${shotKb(s.byte_len)}` ``. `shotKb` renders
`"812 KB"` under 1MB and `"1.4 MB"` above.

> A bug-report screenshot is unreadable at thumbnail size — the point is usually
> the small number in the corner — so a click has to open it big.

`Lightbox` is `fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center
p-6` over `alpha(T.bg, 0.88)` → `color-mix(in srgb, var(--color-bg) 88%, transparent)`.
The image stops propagation so a click on it does not close. Escape closes.
Top-right hint: **"Esc to close"** in `text-xs text-faint`.

---

## Status and empty-state messages, verbatim

| String | Where | When |
|---|---|---|
| `Loading…` | My tickets card | `!listLoaded` |
| `No tickets yet. Send one from the New tab and it will show up here.` | My tickets card | `listLoaded && tickets.length === 0` |
| `Loading ticket…` | thread card | `openId != null && thread == null` |
| `This ticket is marked complete. Replying reopens it.` | above the composer | `status === 'resolved' && !isOwner` |
| `Write a message or attach a screenshot first.` | page-level error line | `submit()` with empty text and no shots |
| `Failed (<status>)` | page-level error line | POST returned non-ok with no `{error}` body |
| `Something went wrong.` | page-level error line | `submit()` threw a non-`Error` |
| `Reply failed.` | page-level error line | `reply()` threw a non-`Error` |
| `Only 6 images per message — the rest were skipped.` | composer error | more files than slots via the 📎 button |
| `Up to 6 images per message.` | thrown by `prepareShots` | queue already full |
| `Could not attach that image.` | composer error | `prepareShot` threw a non-`Error` |
| `<name> isn't an image.` | thrown | non-`image/*` MIME |
| `Could not read that file.` | thrown | `FileReader` error |
| `That file isn't an image we can read.` | thrown | `<img>` decode failure |
| `That GIF is too big — 5MB max.` | thrown | GIF over 5MB |
| `Your browser wouldn't let us resize that image.` | thrown | no 2D context |
| `That image is too big even after resizing.` | thrown | > 5MB after JPEG |
| `Esc to close` | lightbox, top right | lightbox open |
| `Enter to send · Shift+Enter for a new line` | composer footer, left | always, on this page |
| `or paste / drag an image in` | attachment tray | queue empty |
| `Sending…` | submit / send buttons | in flight |
| `Adding…` | 📎 button | `prepareShots` in flight |

**Intro paragraph**, `max-w-3xl text-xs leading-relaxed text-muted`:

> Every bug you flag, idea you share or note you leave shapes CB Edge. Send one
> and it opens a ticket you keep — replies land right here, and the badge on your
> avatar lights up when there is one waiting.

**Page title:** `Feedback & Support`.
**Tab labels:** `✍ New` and `` `📬 My tickets${tickets.length ? ` (${tickets.length})` : ''}` ``.

The page-level error is `<p class="text-xs font-semibold text-down">`, rendered
between the intro and the cards, and cleared on every tab switch
(`setError(null)` inside the `SegGroup` handler) and at the start of every
submit/reply.

---

## Rendering, tokens and layout constants

| Class | Token | Hex |
|---|---|---|
| `bg-bg` (page canvas, textarea fill, `UnreadDot` ink) | `--color-bg` | `#0a0d10` |
| `bg-surface` (card plate, `✕` button plate) | `--color-surface` | `#0e1216` |
| `bg-surface2` (list rows, their-side bubbles, thumbnails) | `--color-surface2` | `#141a21` |
| `hover:bg-raised` | `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` |
| `border-line` | `--color-line` | `#1e2630` |
| `text-fg` | `--color-fg` | `#e7ece9` |
| `text-muted` | `--color-muted` | `#e7ece9` |
| `text-faint` | `--color-faint` | `#c0c5c3` |
| `border-accent` / `text-accent` / `ring-accent` | `--color-accent` | `#2f6bff` |
| `bg-warn` / `text-warn` / `border-warn` | `--color-warn` | `#ffd166` |
| `text-down` / `border-down` | `--color-down` | `#ff6b7a` |

Via `theme.ts`: `T.cyan = var(--color-accent)`, `T.orange = var(--color-warn)`,
`T.bg = var(--color-bg)`. `alpha(c, a)` emits
`color-mix(in srgb, <c> <a*100>%, transparent)`.

Type scale used here: `text-3xs` 9px (status chip), `text-2xs` 10px (counters,
stamps, buttons, hints), `text-xs` 11px (notes, category on a list row),
`text-sm` 13px (bubble body, list subject, card titles), `text-lg` 18px (page
`h1`).

Layout numbers worth remembering:

- Conversation scroll region: **`h-96` = 384px**, fixed.
- Bubble and gallery width cap: **88%**.
- Thumbnails: sent `h-20 w-32` (80×128), queued `h-16 w-24` (64×96).
- Ticket-list date column: **`w-16` = 64px**.
- `UnreadDot`: `h-4 min-w-4` = 16px.
- Avatar: `h-7 w-7` = 28px, its dot `h-2.5 w-2.5` = 10px with a 2px `border-bg`.
- Account dropdown: `w-60` = 240px, `z-50`.
- Lightbox: `z-50`, `p-6` = 24px.
- Card header: `h-8` = 32px, never wraps (`cb-bar`).
- Page body: `flex flex-col gap-3 p-4`.

**Tap targets.** This page has never been in `DESKTOP_TO_MOBILE`, so
`MobileRedirect` leaves it alone and a phone gets the desktop layout. The
buttons are `sm`-sized (`SegGroup`'s default is `px-1.5 py-0.5 text-2xs`), the
list rows land around 36–40px, and `SEND_BTN` is `px-4 py-1.5` ≈ 30px tall —
all **under** the 44px floor `MobileTabBar` is careful to clear. Acceptable for
a surface reached a couple of times a quarter, but it is the reason there is no
`/m/feedback` tab.

---

## Performance and bundle

- **Its own lazy route chunk.** `vite.config.ts` does no manual chunking for it;
  the chunk is named after the file, which is what makes a budget failure
  legible in `check-budgets.mjs` output.
- **Budget:** `route` = **59100** brotli bytes in `budgets.json`. Nothing here is
  heavy — no chart library, no canvas, no static table. The page's real cost is
  in *images at runtime*, which are not bundle bytes.
- **`shots.ts` is a third copy, knowingly:** "`components/shared/feedbackShots.ts`
  (Next) and `owner-vite/src/lib/feedbackShots.ts` are the same file. v3 shares
  no code with v2 in either direction — that is the clean-slate rule, not an
  oversight — so this is a copy the way the thread itself is a copy. It is ~150
  lines of pure function with no imports; **when one changes, change all three.**"
  `Thread.tsx` says the same about itself: "MIRROR:
  `components/shared/FeedbackThread.tsx` (Next) and the inlined copy in
  `owner-vite/src/pages/Feedback.tsx` draw the same thing on v2's palette. […]
  Change the API shapes in one and check the others."
- **`UserMenu` is in the entry chunk.** `Shell.tsx` imports it statically —
  unlike `NotesDock`, `NoteClipMenu`, `AlertsPanel`, `BzilaPanel` and
  `BotAlertPanel`, which are all `lazy()` to keep the entry chunk under its
  **38900** byte line. So the badge's 60s poll and the two navigating rows ship
  to everyone on first paint; the *page* does not.
- **No socket topics.** Nothing here calls `useFrame` / `useField` /
  `watchFrame`, so `npm run check:ws` sees this route contribute nothing to the
  derived scope.
- **No canvas.** `npm run perf` counts repaints on elements tagged
  `data-cb-layer`; this route owns none, so it contributes nothing to
  `idleRepaintsPerFrame` (0.15), `offscreenRepaints` (0) or
  `interactionRepaints` (10). The one canvas the route *creates* —
  `document.createElement('canvas')` inside `prepareShot` — is transient, never
  attached to the document, and correctly carries no `data-cb-layer` tag.
- **The 15s thread poll is the only recurring cost**, and it stops dead when the
  tab is hidden or `?ticket` is cleared.

---

## Gotchas

1. **`page` on a new ticket is the literal string `'/v3/feedback'`.** It records
   where the form was, not where the user hit the bug. If the ticket row's
   `page` column is being used to triage, it is useless from this front end —
   every v3 ticket looks identical. The Next page sends its own path.

2. **The ticket list is never polled.** It refetches on mount, after `submit`,
   after `reply`, and on "← All tickets" — nothing else. Sit on the list for ten
   minutes and an owner reply will not appear there, even though the *avatar
   badge* (a different poll, in `UserMenu`) will light up.

3. **Two independent unread numbers.** `Feedback.tsx` reads `unreadCount` from
   `/api/feedback?scope=mine` into the badge beside the tab switch;
   `UserMenu.tsx` reads it from `/api/feedback?scope=mine&limit=1` into the
   avatar. Different requests, different cadences, so they can disagree for up
   to a minute.

4. **`replace: true` on every query-string write.** Opening a ticket and
   pressing Back leaves `/feedback` entirely rather than returning to the list.
   The header's claim that "Back works" is about the *route*, not about the tab
   or ticket steps within it.

5. **Ticket rows are `<button>`, not `<a>`.** The URL is shareable, but you
   cannot middle-click a row to open a ticket in a new tab, and there is no
   status-bar preview of where it goes.

6. **`openIdRef.current = openId` is assigned during render**, not in an effect.
   It is the guard against a late poll response, and it works, but it is a
   render-phase mutation — do not "clean it up" into a `useEffect`, or the ref
   will be one render stale exactly when the guard is needed.

7. **Enter sends in the thread composer but not in the new-ticket textarea.**
   The `onKeyDown` handler lives only in `Thread`. In the New form, Enter makes
   a newline — which is right for a first report, and surprising if you have just
   come from a thread.

8. **`prepareShots` throws on the first bad file and discards the good ones
   already prepared in that batch.** Drop three valid PNGs and one PDF and you
   get an error and zero attachments, not three.

9. **`useShotDrop.take` never clears a previous error.** `ShotTray.add` calls
   `onError(null)` before working; the paste/drop path does not. A stale error
   line can survive a successful drop until the next tab switch or submit.

10. **GIFs bypass the downscaler entirely** and are allowed up to 5MB raw.
    Base64 inflates that by about a third, so a single 5MB GIF is a ~6.7MB JSON
    body — an order of magnitude past anything the resize path can produce.

11. **`maxLength={5000}` is markup-only.** Paste-past-the-limit is blocked by the
    browser, but nothing in JS re-checks before the POST. The server is the real
    limit, and the `{message.length}/5000` counter exists only on the New form —
    the thread composer has the same cap and no counter.

12. **The customer can never close a ticket.** `onSetStatus` is not passed, so
    the Mark complete / Reopen button never renders here; the keyboard hint takes
    its slot. Closing is the owner's, reopening is the server's.

13. **A reply that fails loses the text.** `send()` clears `draft` and `pending`
    before awaiting `onSend`, so a network failure surfaces "Reply failed." with
    an empty box and no attachments.

14. **`isOwner` on this page changes two strings and nothing else** — the
    placeholder and the staff label. Do not use it as a permission check; the
    prop doc is explicit that "the server is what enforces who may reply or close
    a ticket."

15. **Attachments on the opening message have `message_id === null`, not `0`.**
    `shotsFor` uses `== null` deliberately so `undefined` behaves the same way.
    A strict `=== null` rewrite would silently drop attachments from a payload
    that omits the field.

16. **`num()` exists because Postgres `COUNT` is a bigint string.** Doing
    `t.reply_count > 0` directly compares a string; `"10" > 0` happens to work
    and `"abc" > 0` does not. Always go through `num()`.

17. **Three copies to keep in step.** Change an API shape here and you owe the
    same change to `components/shared/FeedbackThread.tsx` +
    `components/shared/feedbackShots.ts` (Next) and to
    `owner-vite/src/pages/Feedback.tsx` + `owner-vite/src/lib/feedbackShots.ts`.
    Nothing in CI catches a divergence.

18. **Do not give this page a rail icon.** It is the one intentional exception to
    the four-step rule, and the reason is written down: "An icon for it would push
    a working destination out of the rail to save a customer one click a quarter."
