# Voltick · Design System

A working reference for anyone building or designing Voltick surfaces. Every value
here is lifted from the shipping code, not reconstructed from a mockup. Where a
value is load-bearing, the reason is written next to it, because most of these were
arrived at by fixing something.

**Source of truth:** `web/src/theme.jsx`. Tokens are exported constants; the CSS
custom properties are declared once in `web/index.html`. If this document and that
file ever disagree, the file wins.

---

## 1 · What the product is

Voltick maps options dealer positioning across 1,000+ tickers. It names the strike
levels where market makers are forced to hedge, which act as magnets and walls that
price tends to defend or accelerate away from. The single strongest such level on a
board is the **Volt**.

The interface is a dark, dense, data-first terminal. It is read by people who are
looking at numbers all day, often on a phone, often in a hurry, frequently while the
market is moving. That sets the whole tone: **calm surfaces, loud data.**

---

## 2 · The non-negotiables

Five rules that are not style preferences. Breaking any of them is a defect.

1. **The reserved colours mean one thing each.** See §3.4. A colour is a word in
   this product. There is a test in the suite that fails the build on a near-miss
   hex.
2. **No grey text, ever.** See §3.2.
3. **No em-dashes in anything a user reads.** Use a middle dot `·`, comma, colon or
   parentheses. Code comments are exempt.
4. **Never buy, sell, signal, entry, target or prediction.** The product describes
   mechanics and locations. It does not advise. See §10.
5. **Dark only.** There is no light theme. `useTheme()` pins `<html>` to
   `data-theme="dark"` and clears any stale preference, so no light override can
   match.

---

## 3 · Colour

### 3.1 Surfaces

| Token | Hex | Use |
|---|---|---|
| `INK` | `#0a0d10` | Page background. Everything sits on this. |
| `PANEL` | `#0e1216` | Bars, panels, the chrome around content. |
| `ELEV` | `#141a21` | A raised card surface, one step above panel. |
| `LINE` | `#1e2630` | Hairline borders. Never heavier than 1px. |

Popovers use `rgba(15,19,24,0.98)`, nav uses `rgba(10,13,16,0.8)` with a blur
behind it.

The surfaces are close together on purpose. Depth is carried by a hairline and a
shadow, not by a big jump in lightness, so a dense screen does not turn into a
patchwork of grey rectangles.

### 3.2 Text

| Token | Hex | Use |
|---|---|---|
| `PAPER` | `#e7ece9` | All body text, labels, values. ~14.5:1 on Ink. |
| `PAPER_DISPLAY` | `#d6ddd8` | 16px+ **bold** headlines only. |
| `PAPER_QUIET` | `#c0c5c3` | Context: units, the caption under a number. 10.76:1. |

**There is no grey text in this product.** Secondary information is expressed
through size, weight, spacing and position, not by dimming it. This is a founder
decree, arrived at after grey secondary text read as "washed out" on every screen.

`PAPER_DISPLAY` exists because large bold glyphs render visually hotter than body
text at the same hex (more lit pixels per glyph), so a headline at `PAPER` reads as
pure white. It is one step deeper so it *matches* body text optically. Do not
equalise them back.

The three above are not a light/medium/dark ramp. They are one colour, optically
corrected for three contexts.

### 3.3 Brand

| Token | Hex | Use |
|---|---|---|
| `ACCENT` | `#2f6bff` | Volt Blue. **Fills, borders, rings, glows. Not words.** |
| `ACCENT_TEXT` | `#6aa0ff` | When the accent has to be *text*, this is the accent. |
| `SKY` | `#7fb0ff` | Bolt Sky. Gradients, highlights, fine lines. |
| `ACCENT_SOFT` | `rgba(47,107,255,0.12)` | Tinted backing for a selected row. |

`ACCENT` at `#2f6bff` does not carry enough contrast to be read as text on Ink.
That is what `ACCENT_TEXT` is for. Using `ACCENT` for a word is the single most
common mistake in this palette.

Text selection is `rgba(47,107,255,0.40)` so selecting glows Volt Blue instead of
browser beige.

### 3.4 Reserved data colours · **read this section twice**

Each of these means exactly one thing in this product. They are vocabulary, not
decoration. A member learns them in the first session and then reads the whole
product by colour. Using one for anything else does not look slightly wrong, it
says something false.

| Hex | Mark | Means | May be used for |
|---|---|---|---|
| `#ffd166` | ★ | **The Volt** · the strongest level on a board | the Volt, and nothing else |
| `#b48cff` | ⚡︎ | **The gamma flip** | the flip, and nothing else |
| `#ff5fa2` | ↘ | **A Reversal** | reversals, and nothing else |
| `#4d8cff` | ↯ ‖ | **Surge / walls** | surges and walls |
| `#2f6bff` | ◆ | **The Coil** (same hex as `ACCENT`) | the coil, and accent chrome |
| `#8adb57` | | **Pre-market** | pre-market state |

Inks for text sitting *on* a filled row of these: `#36081d` on magenta,
`#071026` on surge, `#1a1404` on amber.

**Two traps that have already cost time:**

- **Near-misses are worse than reuse.** `#141a20` instead of `ELEV`'s `#141a21`
  shipped across 45 usages once. `server/test/reserved-colours.test.js` now fails
  the build on hand-minted hexes. Always import the token.
- **The flip glyph must be `FLIP_MARK`**, which is `⚡` + U+FE0E (variation
  selector 15). A bare `⚡` defaults to emoji presentation and the system font
  paints it Apple-orange, discarding your `color`/`fill` — and orange is the
  Volt's reserved colour. So a bare bolt silently draws the flip in the Volt's
  colour. Always `FLIP_MARK`.

### 3.5 Semantic

| Token | Hex | Use |
|---|---|---|
| `GOOD` | `#3ddc8e` | Support, positive, live. **Data only.** |
| `BAD` | `#ff6b7a` | Danger, negative. **Data only.** |

"Data only" is the point: green and red carry P&L meaning on a trading screen, so
they never appear as UI chrome, a success toast, or a hover state. If a control
needs to say "this worked", it says it in `PAPER` with `ACCENT` chrome.

---

## 4 · Typography

| Token | Stack |
|---|---|
| `SANS` | `'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif` |
| `MONO` | `'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace` |

**Every number is mono.** Prices, strikes, sizes, percentages, times, tickers in a
tape. This is not an aesthetic choice: a column of proportional digits does not
line up, and this product is columns of digits. Inter carries prose, labels and
buttons.

| Token | Weight | Use |
|---|---|---|
| `W_REG` | 400 | Inter body, quiet labels |
| `W_MED` | 600 | Inter buttons, sub-emphasis |
| `W_BOLD` | 700 | Inter headings, emphasis · **the ceiling for prose** |
| `W_DATA` | 800 | JetBrains Mono hero numbers **only** |

800 is reserved for a headline figure in mono. Prose never goes above 700.

Uppercase labels (`EXPECTED MOVE`, `PUT`, `CALL`) take mono, ~9.5–11px, weight 600,
and letter-spacing around `.06em`–`.09em`. Reach for
`font-variant-numeric: tabular-nums` anywhere digits stack.

---

## 5 · Shape and elevation

| Token | Value | Use |
|---|---|---|
| `R_SM` | 6px | Chips, badges, small tags |
| `R_MD` | 10px | Buttons, inputs, stat tiles |
| `R_LG` | 12px | Cards, panels, modals |
| `R_PILL` | 99px | Fully-round pills |

Card shadow:
`0 8px 26px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.045)`

The inset top highlight is doing real work. On surfaces this close in value, a
1px light line along the top edge is what separates a raised card from the panel
behind it. Drop it and cards go flat.

**Not everything is a card.** Border, fill, radius and shadow each say "separate
object". Spend them by role. One radius and one shadow stamped on every block
flattens the hierarchy it was meant to create.

---

## 6 · Layout

### 6.1 The breakpoint

**760px.** One number, from `useMobile(bp = 760)`. Above it, desktop; at or below,
the mobile layout. A second breakpoint at **1100px** governs whether the board is
wide enough to carry the inline watchlist row.

Avoid inventing new breakpoints. Two components each picking their own is how a
duplicate CTA shipped once; use the layout's number.

### 6.2 Desktop chrome

- **Left rail:** 180px expanded, 48px collapsed to icons.
- Content sits in a centred container, typically `max-width: 1240px` with a gutter.
- The rail carries six destinations: Education, The Board, Flow, Read The Market,
  The Receipts, Yours. Flow sits directly under The Board because it is the one
  shelf that changes while you are looking at it.

### 6.3 Mobile chrome

- **Bottom tab bar:** 46px tall, plus `env(safe-area-inset-bottom)`.
- Five tabs, in this order: **Map · Flow · Scan · Yours · More**, carrying the
  bolt, a triple tilde, a sparkle, a star and the menu rule.
- The tab bar is `position: fixed`, `z-index: 58`, background
  `rgba(11,15,19,0.94)`.

Known wart, documented in the source: those five marks are *glyphs*, and every
glyph carries its own ink, so the row has to be re-tuned per character (26, 26,
23, 19, 26px) to stop one towering over its neighbours. The intended fix is an
icon set. Do not copy the per-glyph sizing into anything new.

### 6.4 The Volt Board

The core screen. A strike ladder: strikes descend down the centre, call gamma
extends right, put gamma extends left, with the spot row highlighted and named
levels (Volt, walls, flip, reversal) marked by their reserved colour and mark.

Rules that hold everywhere a level is drawn:

- **Level names are axis numbers.** A level label must sit at the price it names.
  A rail drawn at 712.0 labelled "711.95" is a picture that lies about itself.
- **The flip is drawn where the sign actually changes**, not where it would look
  tidy.
- **DTE is calendar days**, never trading days.

### 6.5 The Terminal

A free-form workspace of up to six panes (Volt Board, Chart, Flow Tape, Terminal,
Alerts, Scanner) that the member arranges and which persists. On a phone the panes
stack and dragging is disabled.

`touch-action` rides *with* draggability, the way `cursor` does: a draggable pane
head takes `none`, a non-draggable one takes `auto`.

### 6.6 Scrolling and overlays

- Inner scrollers take `overscroll-behavior: contain` so a flick that reaches the
  end of a list does not drag the page behind it.
- Fixed overlays must portal to the body. A rail or pane that creates a stacking
  context will bury them otherwise.
- Wide content (tables, tapes, diagrams) scrolls inside its own
  `overflow-x: auto` container. The page body never scrolls sideways.

---

## 7 · Motion and the aurora

### 7.1 The aurora

A shared static gradient sky, mounted as `AURORA_CSS` and applied with
`.vk-aurora` plus a variant. It is what stops a dark product reading as a black
rectangle.

| Class | Where | Note |
|---|---|---|
| `.vk-aurora-page` | A whole page | **Pinned to 820px.** |
| `.vk-aurora-band` | A section band | **Pinned to 240px.** |
| `.vk-aurora-panel` | A panel or modal | Bloom enters top-left, leaves right |
| `.vk-aurora-rail` | The left rail | Tall and narrow needs its own gradient |
| `.vk-aurora-bar` | A short wide bar | Placed at 50% so the bar sits mid-bloom |
| `.vk-aurora-foot` | The footer | Rises from below, quieter (0.20 vs 0.26) |

The page sky, for reference:

```css
radial-gradient(1100px 520px at 10% -12%, rgba(47,107,255,0.26), transparent 60%),
radial-gradient(880px  460px at 92%  -6%, rgba(77,140,255,0.18), transparent 62%),
radial-gradient(760px  420px at 46% 112%, rgba(61,220,142,0.06), transparent 66%);
```

**The heights are pinned in pixels for a reason.** Percentage heights drift on a
tall page: the sky stretched until its gradient stops fell outside the viewport
and it drew nothing at all, on every marketing page, for months, unnoticed. If you
add a variant, pin its height.

`.vk-aurora` sets `isolation: isolate`, which is load-bearing — the bloom is a
`z-index: -1` pseudo-element, and without a stacking context it paints behind its
own parent's background, which is to say not at all.

### 7.2 Motion

- One thing moves at a time. The hero CTA breathes; nothing around it does. Six
  pills each breathing on their own cycle is a light show, not a page.
- Nothing strobes. Nothing cycles faster than about 1.5Hz.
- `@media (prefers-reduced-motion: reduce)` parks every animation on a sensible
  still frame — not `opacity: 0`, an actual composed frame.
- **Everything meant to be read is visible at rest.** A section may animate in,
  but from a visible resting state, never parked waiting on an observer. A page
  whose content depends on script is a page that shows nothing when script fails.

---

## 8 · Component idioms

### 8.1 The lit pill (the aurora CTA)

The house CTA. A dark face with a gradient *rim* and a soft halo:

```css
border: 1px solid transparent;
background:
  linear-gradient(#0d1117f0, #0d1117f0) padding-box,
  linear-gradient(118deg, #2f6bffd6, #7fb0ffa6 38%, #2f6bff5c 64%, #4d8cffc4) border-box;
```

Two backgrounds in one declaration: the face paints to the **padding box**, the
aurora to the **border box**. That is the only way to put a gradient on a border
without a wrapper element.

**The face must be near-opaque and dark.** A translucent face lets the halo shine
through and the pill renders as a solid blue slab, which is the opposite of the
effect.

The halo is either a blurred `z-index: -1` pseudo (needs a stacking context on a
known ancestor) or a spread `box-shadow` (answers to nothing but the button, and
is the right choice when the component is dropped into sections you do not
control).

### 8.2 Chips

Small pills carrying a mark plus a value: `★ VOLT 772`, `‖ WALLS 748/784`,
`⚡︎ FLIP 760`. Mark and value both take the level's reserved colour. `R_PILL`,
mono value, ~11px, weight 600–700.

### 8.3 Tap targets

Minimum 44px on touch. The mobile rows in menus carry `minHeight: 44` and
`touch-action: manipulation` explicitly.

### 8.4 Gestures

A finger has more meanings than a mouse, and a control has to disambiguate them
before it acts:

- **Tap** opens.
- **Swipe** scrolls the container.
- **Long press (400ms) then drag** reorders.

Never `touch-action: pan-y` on a draggable item inside a horizontally scrollable
row: iOS reads the gesture as a pan it is entitled to take and fires
`pointercancel` mid-drag, and the same value stops the row scrolling at all. Use
`manipulation`, arm the drag with a press, and freeze the row with a non-passive
`touchmove` listener only while armed.

---

## 9 · Copy

Words are design material here, and two rules are absolute.

- **No em-dashes.** Middle dot `·`, comma, colon, semicolon or parentheses. This
  includes null placeholders: a `—` where a value is missing became `·`
  everywhere. (The minus sign `−` U+2212 in signed numbers is a different
  character and stays.)
- **No grey text.** As §3.2.

And the precision rule:

- **Copy must be literally true, not conventionally true.** Levels are *sticky*
  (hedging fights moves, both sides) or *slippery* (hedging chases moves, both
  directions). "Speed bumps" and "danger zones" are fine because they are
  behaviourally true. Positional words (floor, ceiling, shelf) are fine when tied
  to where price actually is. Check every new claim against the engine before it
  ships.

Voice: active, specific, never clever at the expense of clear. A control says
exactly what happens — `Publish`, then a toast that says `Published`. Errors say
what went wrong and how to fix it, with no apology and no vagueness.

---

## 10 · Compliance · hard limits

Voltick is market analytics for educational purposes. It is not an investment
adviser and must never read as one.

- **Never** buy, sell, signal, entry, target, stop, or prediction. Anywhere.
- Describe **mechanics and locations**, never actions.
- Illustrations and example data carry a visible line saying so
  (`Example data only, not a live quote.`).
- Past behaviour of a level is **not** a prediction of future behaviour, and the
  page says so.
- Testimonials are stripped of trade, profit and buy/sell claims.

The rule follows the conduct, not the domain: moving copy to a newsletter, Discord
or X does not relax it. **Crank tone, urgency and the receipts. Keep substance
descriptive.**

---

## 11 · Accessibility

- Contrast is measured, not eyeballed. `PAPER` ~14.5:1, `PAPER_QUIET` 10.76:1 on
  panel. The aurora footer ground was re-measured when it was added: Paper 13.6:1,
  Quiet 9.3:1.
- Keyboard focus always has a visible state. Hover and focus cannot be inline
  styles in React — navigation that does not answer the pointer reads as disabled.
- Every illustration carries a real `<desc>` describing what it shows.
- Touch targets 44px minimum.

---

## 12 · Where things live

| What | Where |
|---|---|
| Tokens, colours, type, radii, aurora | `web/src/theme.jsx` |
| CSS custom properties | `web/index.html` |
| Desktop rail | `web/src/Rail.jsx` |
| Mobile tab bar | `MobileTabBar` in `web/src/theme.jsx` |
| The board | `web/src/Voltick.jsx` |
| The chart | `web/src/HeatChart.jsx` |
| The terminal | `web/src/Terminal.jsx` |
| Reserved-colour guard | `server/test/reserved-colours.test.js` |

---

*Generated from the Voltick codebase. Values are current as of the date this file
was produced; `web/src/theme.jsx` remains the source of truth.*
