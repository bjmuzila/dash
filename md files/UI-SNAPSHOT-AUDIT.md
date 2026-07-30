# UI / Snapshot audit — findings & method

Audited `origin/main` of `bjmuzila/dash` (your local tree is a few commits ahead —
re-run the script locally for exact numbers). 487 source files under
`app/ components/ lib/ app-vite/src/ hooks/`.

---

## Answering the three questions

### 1. "Is the snapshot button / its settings universal?" — No.

There are **8 independent `html2canvas()` call sites**, each its own snapshot
engine with its own hardcoded options. There is no shared capture module, and no
snapshot settings store anywhere in the app (`grep` for a snapshot pref/localStorage
key returns nothing).

| call site | bg | scale | onclone fixes | gradient-text fix | live-canvas fix |
|---|---|---|---|---|---|
| `components/shared/DataBox.tsx:156` | `#05080d` | `devicePixelRatio` | yes | **no** | yes |
| `components/shared/CopySnapButton.tsx:54` | `HT.bg` (`#05060A`) | `min(2,dpr)` | yes | yes | **no** |
| `app/ict/page.tsx:1138` | `#080b10` | *(unset → 1)* | **no** | **no** | yes |
| `components/dashboard/EstimatedMoves.tsx:1210` | `#080c14` | `2` | **no** | **no** | **no** |
| `components/scanner/GexChangeTop.tsx:81` | `HOME_THEME.bg` | `2` | **no** | **no** | **no** |
| `components/scanner/GexChangeTop.tsx:106` | `HOME_THEME.bg` | `2` | **no** | **no** | **no** |
| `components/scanner/GexChangeTop.tsx:132` | `HOME_THEME.bg` | `2` | **no** | **no** | **no** |
| `lib/discord/econSnapshot.ts:552` | `#08111f` | `1.5` | **no** | **no** | **no** |

**6 different background colors. 4 different scales.** None of them is
`HOME_THEME.bg` consistently — five are hardcoded hex that don't match the theme,
which violates the "never hardcode hex" rule in `AGENTS.md`.

Separately, `components/shared/SnapButton.tsx` (the 📸 Discord button) doesn't use
html2canvas at all — it does `document.querySelectorAll("canvas")` and grabs
**whichever canvas has the largest pixel area on the page**. On any page with more
than one chart that is a coin flip, and it's a strong candidate for the "some snaps
are just wrong and strange" complaint.

### 2. "Button font is not in the middle of the buttons" — root cause found.

260 inline-styled `<button>` elements. **191 of them (73%) center their label with
padding alone** — no `display:flex`, no `alignItems:center`, no `lineHeight`.

That's invisible until something imposes a height the button didn't ask for. Three
things do:

1. **`app/globals.css:341`** — inside `@media (max-width: 899px)`:
   `main button, main a[role="button"], main select { min-height: 38px; }`
   A default `inline-block` button with `min-height` puts its label at the **top**
   of the 38px box, not the middle. Every padding-only button in `main` is
   off-center below 899px wide.
2. **Flex parents with default `align-items: stretch`** — the button grows to the
   row height, label stays at padding-top.
3. **Emoji labels** (`📸`, `💬`, `✓`, `✕`) have a taller line box than the Latin
   text they sit next to, so the baseline shifts. `SnapButton` and
   `CopySnapButton` both swap between an emoji label and a text label per state —
   the button visibly jumps between `📸 Snapshot` and `Capturing…`.

5 buttons are off-center **right now at every width** (explicit height, no flex):

```
app/owner/budget/page.tsx:1344
app/owner/budget/page.tsx:2559
app/toolbar-preview/page.tsx:717
app/toolbar-preview/page.tsx:987
components/shared/DockToolbar.tsx:538
```

### 3. "Some snaps are just wrong and strange" — the mechanical causes

- **104 `backdropFilter` panels.** html2canvas does not implement
  `backdrop-filter`. Every frosted panel captures flat. Cosmetic but it's why snaps
  don't look like the app.
- **5 `background-clip:text` gradient headings.** These render *invisible* unless
  flattened in `onclone`. All 5 are marked `data-snap-plain` — but only
  `CopySnapButton` reads that attribute. Capture the same heading through
  `DataBox`, `EstimatedMoves`, `GexChangeTop`, `ict`, or `econSnapshot` and the
  heading vanishes.
- **Only 1 `data-html2canvas-ignore` marker in the whole app**, so live-updating
  chrome (timestamps, "updated 3s ago") lands in captures mid-tick.
- **`scale` unset in `app/ict/page.tsx`** → that one snapshot is 1× while others
  are 2×, so it looks soft next to them.

---

## The best way to audit this

Static analysis first, visual regression second. Static catches ~90% of it in a
second and can't drift, so put it in the build the same way
`app-vite/scripts/check-routes.mjs` already guards routing.

**Step 1 — run the script (attached, drop it at `scripts/audit-ui.mjs`):**

```bash
node scripts/audit-ui.mjs           # full report
node scripts/audit-ui.mjs --json    # machine-readable
node scripts/audit-ui.mjs --strict  # exit 1 on regressions — wire into npm run build
```

It reports both defect classes with file:line, and `--strict` fails when there is
more than one snapshot engine, when any button has a height without flex, or when a
gradient heading is unmarked. Once you've consolidated, that flag keeps it
consolidated.

**Step 2 — fix the two root causes, not the 191 sites.**

*Buttons:* one global rule in `app/globals.css` fixes almost all of it, because
these are all real `<button>` elements:

```css
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
```

Add it next to the existing `button, input, select, textarea { font: inherit }`
block at line 49. Inline `display:flex`/`grid` on individual buttons still wins, so
nothing that's already correct breaks. Then fix the 5 explicit-height ones by hand.

*Snapshots:* extract one `lib/snapshot.ts` with a single `captureElement(el, opts)`
that owns the theme background (`HOME_THEME.bg`), one scale policy, and **all** the
`onclone` fixes currently scattered across the 8 sites — the `data-snap-plain`
flattening from `CopySnapButton` plus the live-`<canvas>` rehydration and
flex-height unclamping from `DataBox` (that file's comments say those were four
rounds of debugging; don't lose them). Then rewrite the 8 call sites to call it.
Retire `SnapButton`'s largest-canvas heuristic in favour of an explicit ref.

**Step 3 — visual regression for the remainder.**

Only after step 2, because otherwise you'd be baselining 8 different engines.
Playwright is already viable here (`app-vite` builds in Docker). One spec that, per
route: sets viewport to 1440 and 880 (crossing the 899px breakpoint), screenshots
the toolbar strip, clicks the snapshot button, and diffs the produced PNG against a
committed baseline. That's the only way to catch "flat frosted panel" and
"invisible heading" classes, since neither is statically detectable at the point of
render.

**Step 4 — a page-by-page pass is the wrong first move.** 191 sites × manual
inspection is days of work that a 5-line CSS rule and one shared module obviate.
Do steps 1–3 and re-run the script; whatever is still flagged is the real
hand-work list.
