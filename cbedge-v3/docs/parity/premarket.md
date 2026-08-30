# Parity inventory — Premarket

**What this is.** One line per value the v2 page renders, with where it comes
from, how it is formatted, what changes its colour, and what it shows when the
value is missing. It is the SPEC for the v3 port: the v3 page is finished when
every row here is ticked, and not before.

**Why it exists.** The failure mode this document prevents is rebuilding a page
from scratch — re-deciding what it contains at the same time as building it.
Both jobs were already done in v2. This file finishes the first one so the
second is only construction.

**Scope.** v2's `components/pages/Premarket.tsx` (~3,400 lines) plus everything
under `components/pages/premarket/` and the `GexChurnHistory` export of
`components/shared/GexHeatBar.tsx`. Both tabs, every panel, every badge,
tooltip, toggle and column.

**Total: 441 checklist rows.**

| Part | Covers | Rows |
|---|---|---|
| 1 | Page head · replay transport · regime strip · level rail · Key Levels | 75 |
| 2 | GEX profile ladders ×2 · overnight · GEX changes · sector heat · expected range · catalysts · footer | 95 |
| 3 | Gamma bell curve · gamma book churn · contracts | 124 |
| 4 | Post-Market tab · Historical Recap fallback | 147 |

**Column meanings**

- **Source** — the hook AND the endpoint underneath it, or the exact
  client-side formula where the value is derived. `useMobileGex → /ws/gex gex
  frame → data.callWall` is a source; "the call wall" is not.
- **Format & units** — decimal places, separators, sign prefix, $B/$M scaling,
  `pts`, `%`. What the code actually does, not what looks sensible.
- **Threshold / colour rule** — every condition that changes a colour, a tone
  class or the wording. This is where detail goes missing when a page is
  described rather than transcribed.
- **Empty / loading** — literally what renders when the value is not there.

**Reading the SPX-only notes.** The socket carries one underlying. Rows marked
SPX-only either come from a stream no other ticker has (ES bars, the ES basis,
the freeze and replay captures) or fall back to a per-ticker REST path that
fills fewer fields. Each such row says which.

---


# Part 1 — Page head, replay transport, regime, level rail, Key Levels

Source: `components/pages/Premarket.tsx` (~3356 lines), cross-referenced against
`components/pages/premarket/chainGex.ts`, `components/pages/premarket/postMarketData.ts`,
`lib/calculations/calculations.ts`, `hooks/useMobileGex.ts`.

Scope: A. Page head — B. Docked replay transport — C. Regime strip —
D. GEX Levels · one axis (level rail) — E. Key Levels (basis toggle + six tiles).

Formatter reference used throughout (defined ~line 809-834 of Premarket.tsx):
- `fmtUsd(v, signed=true)` → `$1.92B` (2dp) / `$840M` (0dp) / `$12.4K` (1dp) / `$840` (0dp); `−` prefix always on negatives, `+` prefix only when `signed` (default true); `"—"` if null/NaN.
- `fmtPx(v, dp)` → thousands-separated number at `dp` decimals; `"—"` if null, non-finite, or `≤0`.
- `fmtPts(v)` → `"+123 pts"` / `"−123 pts"`; `"—"` if null.
- `fmtPct(v, dp=2)` → `"+12.34%"` / `"−12.34%"`; `"—"` if null.
- `nf(v, dp)` → plain thousands-separated number, no sign.
- `kDp` (strike/level decimals) = smallest gap between adjacent listed strikes in `perStrike`: `0` if step ≥1, `1` if `0.5≤step<1`, `2` if `step<0.5`; falls back to `spot≥1000?0:2` if the ladder has <2 strikes.
- `pxDp` (traded-price decimals) = `spot≥1000 ? 0 : 2`.
- `pxEps` = `max(0.01, spot*0.00015)` — "no real move" threshold in points.
- `pinEps` = `max(0.05, spot*0.0015)` — "pinned to the magnet" threshold.
- `es(px)` = `px + basis` (null if `basis` is null, i.e. non-SPX or basis untrustworthy).

---

### A. Page head

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Page title (`<h1>`) | Client state: `recapOnly`, `tab` | Plain text, one of 3 strings | `recapOnly` → "Session Recap"; else `tab==="post"` → "Post-Market Recap"; else "Premarket Prep" | Always renders (no empty state) |
| Symbol picker (`<select>`) | Client state `sym`; option list = constant `SYMBOLS` = `["SPX", ...SCANNER_MAIN excl. SPX]` (`lib/scannerTickers`) | Native `<select>`, uppercase ticker text | Each option `disabled` when `(frozen \|\| replayOn) && s2 !== "SPX"` | Never empty; always has ≥1 option (SPX) |
| Symbol picker tooltip (`title=`) | Derived from `replay`/`frozen`/live state | Sentence | `replay` → "Replayed sessions are SPX only"; `frozen` → "Frozen sessions are SPX only"; else "Which symbol to show. SPX is the live-socket board; every other MAIN name is a one-minute chain poll." | n/a |
| Status/expiry chip (`.badge-concept`) | `isZeroDte`, `expiry` (useMobileGex `/ws/gex` socket status frame, or `useChainGex` `/api/expirations`+`/api/chains`, or `frozenGexOf` on a freeze/replay payload); `feedLabel` (client-derived, see below); `sessionLabel(sessionDate)` (client date-format helper) | `"{0DTE\|FRONT} {expiry\|—} · {feedLabel} · {session/openLabel}"` — 5 template variants (see rule column) | `recapOnly` → `"{sym} · RECORDED · {sessionLabel}"`; `replay` → `"{0DTE/FRONT} {expiry} · {feedLabel} · {sessionLabel}"`; `frozen` → `"{0DTE/FRONT} {expiry} · FROZEN {sessionLabel}"`; `sym==="SPX"` live → `"{0DTE/FRONT} {expiry} · {feedLabel} · {openLabel}"`; other live symbol → `"{sym} · CHAIN POLL · {openLabel}"` | `expiry` missing → prints `"—"` in place of the expiry |
| Session picker (`<select>`) | `sessions` memo: primarily `useGexLevelsHistory(40)` → `/proxy/gex-levels-history?symbol=SPX&limit=40`; falls back to `recentSessions()` (client weekday-walk, no holiday calendar) while that request is not `"ok"` | Native `<select>`; option text = `"Today · {sessionLabel}"` for today, else `"{glyph}{sessionLabel}"` | Leading glyph per option: `▸` if `replayByDate.has(d)` (from `useReplayDates` → `/proxy/premarket-replay?dates=1`), else `•` if `freezeByDate.has(d)` (from `useFreezeDates` → `/proxy/premarket-freeze?dates=1`), else two blank spaces. Wrapper gets `.past` class (amber border/caret/text) when `sessionDate !== etDate` | Falls back to the client weekday-walk list (still populated, never truly empty) while the recorded-history fetch is loading or errored |
| Session picker tooltip (`title=`) | Static | Sentence | "Which session to show. Today is live; • marks a captured session that drives the full tabs, ▸ one that can also be replayed minute by minute." | n/a |
| ▶ Replay / ■ Exit replay button | Client state `replayOn`; enablement from `replayByDate` (`useReplayDates` → `/proxy/premarket-replay?dates=1&limit=40`) | Text toggle: `"▶ Replay"` / `"■ Exit replay"` | `disabled` when `!replayOn && !replayByDate.has(sessionDate)` (greyed, not-allowed cursor) | Disabled state IS the empty state — no separate placeholder |
| Replay button tooltip (`title=`) | Same as above | Sentence | Has frames → `"Step {sessionLabel} through its recorded frames — the whole page, minute by minute"`; no frames → `"No frames recorded for this session. The replay recorder captures the page every 5 minutes from 04:00 ET and cannot back-fill a day it was not running for."` | n/a |
| "Premarket" tab button | Client state `tab`, `recapOnly` | Text label, `.on` class when active | `disabled` + `opacity:.4; cursor:not-allowed` when `recapOnly`; tooltip then reads "No captured chain for this session — showing the recorded recap instead" | Disabled state described above |
| "Post-Market" tab button | Client state `tab`, `recapOnly`; dot colour from `frozen`/`afterClose` | Text label + coloured dot (`.tdot`), `.on` class when active | Same `disabled`/tooltip rule as Premarket tab | Disabled state described above |
| Post-Market tab dot colour | `frozen` (isHistorical && captured), `afterClose` (`etMin >= RTH_CLOSE_MIN+5`, i.e. ≥16:05 ET) | Inline-styled 1 dot | `frozen` → `var(--violet)`; else `afterClose` → `var(--blue)`; else `var(--off)` (dim/grey) | n/a — dot always renders one of the 3 colours |
| Frozen-session banner (`.frozenbar`) | `frozen` (`isHistorical && !!frozenGex`, from `useSessionFreeze` → `/proxy/premarket-freeze`), `slotNote` (client-derived) | Sentence: `"Frozen session — {sessionLabel}. Every number below is computed from that day's captured chain by the same code the live page runs{, captured at 16:05 settle \| , captured just before 09:30 open}{slotNote}. Nothing here is live."` | Visible only when `frozen && !replay`. `slotNote` appended when the requested tab's slot is missing but the other slot exists: `" — the settle capture is missing for this session, so this is the pre-open one"` (tab=post, no post capture) or the mirrored sentence for tab=pre | Banner absent entirely when not frozen, or when replay is on (replay's own ⓘ note covers the equivalent disclosure) |

**Sort order.** Symbol picker: SPX pinned first, then `SCANNER_MAIN`'s own order (unchanged). Session picker: today first, then past sessions **newest → oldest**, capped to 39 entries (`SESSION_COUNT − 1`, `SESSION_COUNT = GEX_HISTORY_LIMIT = 40`).

---

### B. Docked REPLAY TRANSPORT bar

Entire bar (`.rplbar`) renders only when `replayOn === true`; it is the last child of `.pmk`, `position:sticky; bottom:0`. All rows below are inside that conditional.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "Replay" tag (`.rpltag`) | Static | Plain text label | none | always shown while bar is open |
| ◀ / ▶ date stepper | `replayDates` = keys of `replayByDate` (`useReplayDates` → `/proxy/premarket-replay?dates=1&limit=40&symbol=SPX`), sorted ascending then `.reverse()` (newest-first) | Icon buttons `◀` `▶` | Steps only across dates that actually have recorded frames; if `sessionDate` isn't in `replayDates` (replay just switched on over a live day), either arrow jumps to the newest recording | No disabled styling coded — a no-op step (`!next \|\| next === sessionDate`) simply does nothing |
| Date label (`.rpldate`) | `sessionDate` via `replayDayLabel()` (client date formatter, same shape as `/es-candles`' day picker) | `"Fri, 8/28"` (weekday-short, numeric month/day) | none | Shows `"—"` if `sessionDate` fails to parse |
| No-frames / loading message (`.rplmsg`) | `replayState` (`usePremarketReplay` → `/proxy/premarket-replay?date=…&symbol=SPX`) | Sentence, 3 variants | `"loading"` → "Loading this session's frames…"; `"error"` → "Could not load this session's frames."; otherwise → "No frames recorded for this session — step ◀ / ▶ to another." | Shown in place of ALL playback controls whenever `replayFrames.length === 0` |
| ⏮ Step-back button | Client state `replayIdx` | Icon button | Clamped to `max(0, i-1)`; also pauses playback | Hidden (not rendered) when `replayFrames.length === 0` |
| ▶ / ⏸ Play/Pause button | Client state `replayPlaying` | Icon swaps `▶`↔`⏸` | Pressing Play while parked on the last frame restarts from frame 0 rather than doing nothing | Hidden when no frames |
| ⏭ Step-forward button | Client state `replayIdx` | Icon button | Clamped to `min(length-1, i+1)`; also pauses playback | Hidden when no frames |
| Scrubber (`DockSlider`, label "min") | Client state `replayIdx`; tick labels via `etClockOf(replayFrames[i].minute)` | Slider, `min=0`, `max=frames.length-1`, `step=1`; displayed value is an `HH:MM` ET clock string per tick | Dragging pauses playback | Hidden when no frames |
| Replay clock chip (`.rplclock`) | `replayFrame.minute` → `etClockOf()`; `replayIdx+1`/`replayFrames.length`; `replayFrame.payload.spot` → `fmtPx(spot, 2)` (2dp always — replay is SPX-only) | `"HH:MM ET · {idx+1}/{total} · spot {n}"` | none (plain informational chip) | `"—:—"` when `replayFrame` is null (bar open but no frame resolved) |
| Speed selector (`SegGroup`, "Speed" label) | Client state `replaySpeed`; options = constant `REPLAY_SPEEDS = [0.5, 1, 2, 4, 8]` | Buttons labelled `"{n}×"` | Active speed highlighted by `SegGroup`; interval timer runs at `REPLAY_BASE_MS(700ms) / replaySpeed` | Hidden when no frames |
| "● Live" exit button | Client action `setReplayOn(false)` | Text button, coloured `HT.cyan` | none | Hidden when no frames (but ✕ below still exits) |
| ⓘ info toggle | Client state `replayNoteOpen` | Icon button, `.on` class + `aria-expanded` when open | Tooltip flips: open → "Hide what this replay covers"; closed → "What this replay covers" | Always visible while bar is open, frames or not |
| ✕ close button | Client action `setReplayOn(false)` | Icon button | none — deliberately outside the "has frames" branch so a session with nothing recorded can still be closed | Always visible while bar is open |
| Coverage-caveat note (`.rplnote`, shown when `replayNoteOpen`) | `replayState`, `replayFrames.length`, `replayTrim` (= `replayFrame?.payload?.trimmedSide ?? 0`) | Paragraph, 4 variants | `"loading"` → "Loading this session's frames…"; `"error"` → "Could not load this session's frames."; no frames → explains the recorder runs every 5 min from 04:00 ET and cannot back-fill; else → full disclosure ("The page IS the replay…", names GEX-watch strip as NOT date-scoped) | Trim-specific sentence ("Frames keep ±{replayTrim} strikes around spot… walls/gamma flip/total net GEX are full-board, max pain/DEX/vanna/profile/bell-curve wings are windowed") appended **only when `replayTrim > 0`** |

---

### C. REGIME strip

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Regime dot (`.dot`) | `hasData` (from `gex.hasData`), `posGamma = (totalNetGex ?? 0) >= 0` | Pulsing 9px dot, 4px glow ring | `!hasData` → `.off` class (`var(--off)`, no pulse); `hasData && posGamma` → base green (`var(--pos)`); `hasData && !posGamma` → `.neg` (`var(--neg)`) | Off/grey, non-pulsing when `!hasData` |
| Regime label (`.lbl`) | Same `hasData`/`posGamma` | 19px bold text | `!hasData` → "WAITING FOR FEED"; `posGamma` → "POSITIVE GAMMA" (green); else "NEGATIVE GAMMA" (red) | Covered by the "WAITING FOR FEED" branch |
| Regime sub-line (`.sub`) | Same | 10.5px muted text | `!hasData` → "no chain frame yet"; `posGamma` → "Dealers long gamma · mean-reverting tape"; else "Dealers short gamma · moves get amplified" | Covered above |
| Net GEX value | `totalNetGex` (useMobileGex socket `gex`/`snapshot` frame `totalNetGex`, or `useChainGex` client sum of `netGEXOf(r,"net",spot)` over the polled chain, or frozen/replay payload's `totalNetGex` — server full-board value, survives the ±N-strike trim on replay) | `fmtUsd(totalNetGex)` — signed, $B(2dp)/$M(0dp)/$K(1dp) | none (plain mono value) | `"—"` when `totalNetGex` is null |
| Net GEX vs-prior-close chip | `netGexChangePct` = client calc `((oiVsBaseline.live − oiVsBaseline.base) / \|base\|) × 100`, where `oiVsBaseline` sums the **OI leg only** (`oiLeg()`) of the live chain vs. the baseline's OI map, over the intersection of strikes. Baseline from `/api/premarket-baseline?expiry=…&basis=oi&symbol=…` | `"{▲\|▼} {n}% OI"`, 11px, `<small>` | `netGexChangePct >= 0` → `▲` + `chg-pos` (green); `< 0` → `▼` + `chg-neg` (red). Tooltip: `"OI-basis change vs the {baseline.date ?? 'prior'} close"` | Chip absent, replaced by `<small>vs prior close —</small>` when `netGexChangePct == null` (no baseline, or baseline's `base === 0`) |
| Gamma Flip value | `flip` (useMobileGex: `findGEXFlip(chain,spot)` client interpolation, falling back to server `gexFlip`; same on chain-poll and frozen/replay sources) | `fmtPx(flip, kDp)` | none | `"—"` when `flip` null or ≤0 |
| Gamma Flip distance sub-line | `distFlip = spot>0 && flip ? spot-flip : null` (client calc) | `"{fmtPts(distFlip)} / {fmtPct(pct)}"` where `pct = (distFlip/spot)*100` | `distFlip >= 0` → `chg-pos`(green); `<0` → `chg-neg`(red) | Renders empty string (no text) when `distFlip == null` |
| SPX/ES (or ticker) label | `sym` | `sym==="SPX"` → label "SPX / ES"; else label = `sym` itself | none | n/a |
| SPX/ES value | `spot`, `esFut` (SPX: useMobileGex socket `aux` frame; non-SPX: `chainGex`, always 0/no ES) | `fmtPx(spot, pxDp)` | none | `"—"` if spot ≤0 |
| SPX/ES sub-line | SPX: `esFut` (`fmtPx(esFut,2)`); non-SPX: `symQ` from `/api/quotes-batch` (`change`, `pct`) | SPX → `"· ES {n}"`; non-SPX → `"{pct%}"` coloured | Non-SPX: `(symQ?.change ?? 0) >= 0` → `chg-pos`; else `chg-neg` | Non-SPX shows `"·"` when `symQ.pct` is null |
| Bias card headline (`.bias .t`) | `posGamma` | Sentence | `posGamma` → "Range day — fade the walls" (green `.t`); else "Trend day — follow the breaks" (red `.t`, card gets `.neg` wash/border) | n/a — always one of the two |
| Bias card detail (`.bias .d`) | `distFlip`, `posGamma`, `flip`, `pxDp`, `kDp` | Sentence | `distFlip == null` → "Flip unavailable — no crossing in the current chain."; else `"{Above/Below} flip by {n} pts. {Suppression regime until {flip} breaks. \| Acceleration regime until {flip} is reclaimed.}"` (clause picked by `posGamma`) | Covered by the null branch above |

---

### D. GEX LEVELS · one axis (level rail)

Rail is built from `rail` memo (client-side): 5 candidate marks — Put Wall, Gamma Flip, CORE (`coreBullseye` = max `|net|` strike over the **whole chain**, client reduce over `perStrike`), Spot, Call Wall — each added only if its price is finite and `>0`. Rail renders `null` (empty state) if fewer than 2 marks qualify, or if the resulting price span is not `>0`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Header range readout (`.rh .tiny`) | `rail.lo`/`rail.hi`/`rail.span` (client min/max/range of the qualifying marks, padded 14% each side for marker room) | `"{fmtPx(lo,kDp)} – {fmtPx(hi,kDp)} · {nf(span,pxDp)} pts"` | none | `"waiting for the chain"` when `rail` is null |
| Call-wall↔put-wall band (`.band`) | `putWall`, `callWall` | Horizontal highlighted band on the track, positioned/widthed by `%` | Rendered only when both walls present, `>0`, and not equal | Band absent (no placeholder) when the condition fails — track still shows |
| PW marker — Put Wall | `putWall` | Position `%` on axis; code `"PW"`; name `"Put Wall"`; price `fmtPx(px,kDp)`; bottom line `fmtPts(dist)` where `dist = px − spot` | Colour `var(--pw)` (theme's down-candle red) | Marker simply absent from the rail if `putWall` is null (part of the ≥2-marks gate) |
| FLIP marker — Gamma Flip | `flip` | Same shape as PW | Colour `var(--amber)` | Absent if `flip` null |
| CORE marker — max γ strike | `coreBullseye.strike` (client: `perStrike.reduce` by max `\|net\|`) | Same shape; label text "CORE · max γ strike" | Colour `var(--violet)` | Absent if `perStrike` empty |
| SPOT marker | `spot` | Same shape, plus `.spot` modifier class (wider dot, white glow ring, colour `#ffffff`); bottom line is **not** a points distance | Bottom line: `es(spot) != null` → `"ES {fmtPx(es(spot),0)}"`; else `"live"` | Absent only if `spot ≤ 0` |
| CW marker — Call Wall | `callWall` | Same shape as PW | Colour `var(--cw)` (theme's up-candle green) | Absent if `callWall` null |
| Rail empty state | `rail === null` | `"Waiting for the chain…"`, centred placeholder, same 120px height as the rail | Shown whenever fewer than 2 of the 5 marks are available | This IS the empty state |

**Sort order.** Markers are sorted **ascending by price** (`a.px - b.px`), then caps alternate `dn`/`up` in that price order (index 0 = down-cap, index 1 = up-cap, …) — cap side is positional, not tied to which level it is. On a narrow viewport (`≤1180px`) the long name (`.ln`) is dropped from each cap, leaving only the 2-4 letter code.

---

### E. KEY LEVELS

Basis switch (`lvlBasis`: `oi` default / `oivol` / `vol`) changes what `lvlByStrike` (client per-strike map, `liveLeg()`) and the `migration` memo read; it does **not** change `perStrike`, the rail, or the magnet's chosen strike (those stay OI+Vol). Persisted to `localStorage`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Basis toggle buttons (OI / OI+VOL / VOL) | Client state `lvlBasis`; labels/hints from constant `LVL_BASIS_META` | 3 buttons, `.on` on the active one | `aria-pressed`; each carries a `title=` hint (per-basis formula + caveat text) | none |
| "vs {baseline.date} close · basis" chip | `baseline` (`/api/premarket-baseline?expiry=…&basis=oi&symbol=…&today=…`), `baselineState`, `migration.available`/`migration.basisHasBaseline` (client) | Sentence / phrase, 3 variants | `.warn` class (amber) when `migration.available && !migration.basisHasBaseline` | No `baseline` → `"prior-close baseline loading…"` (while `baselineState` is `loading`/`idle`) or `"no prior-close baseline — levels only"` (otherwise); baseline present but not on this basis → `"no prior-close baseline on the {basis} basis — levels only"` |
| **Call Wall tile — name** | Static + `isZeroDte`(n/a here) | `"Call Wall"` + badge `"resistance"` | none | n/a |
| Call Wall price | `callWall` | `fmtPx(callWall, kDp)` | none | `"—"` |
| Call Wall ES + $ line | `es(callWall)` (client `callWall+basis`), `wallGex.call` (= `lvlByStrike.get(callWall)`, i.e. the wall's own gamma **on the selected basis**) | `"{ES {fmtPx(es,0)} · }{fmtUsd(wallGex.call,false)}"` | ES segment omitted when `basis` is null (non-SPX) | `fmtUsd` prints `"—"` if `wallGex.call` is null |
| Call Wall distance | `distCall = callWall - spot` (client) | `fmtPts(distCall)` | `distCall >= 0` → `chg-pos`; else `chg-neg` | `"—"` if null |
| Call Wall pill | `overnight.hi` (from ES/ETF candle pool), `callWall`, `basis` | Pill badge | `overnight.hi >= callWall + basis` → `"ON high tagged"` (`.pill.hot`, red-tinted); else `"untested o/n"` (default pill) | Always renders one of the two (no null state) |
| Call Wall migration line | `migration.callWall` = `{ gex: at(callWall) using OI-basis-map vs live selected-basis, px: moved(baseline.callWall, callWall) }`; tag via `wallState()` reading **magnitude** of the gex Δ | `MigLine`: tag chip + `"was {fmtUsd} → {fmtUsd} · {fmtPct}"` + optional note `"wall moved {fmtPts(move)} from {fmtPx(was,kDp)}"` | `wallState`: sign flip → `"flipped sign"` (`.flipt`, violet); `\|pct\|<2%` → `"unchanged"` (no colour); magnitude grew → `"building"` (`.up`, green); shrank → `"eroding"` (`.warnt`, amber). Note line shown only when `\|px.move\| >= pxEps` | Whole line renders nothing (`MigLine` returns null) when there's no baseline gex Δ **and** no px move to report |
| **0DTE Magnet tile — price** | `magnet` (client: max `\|net\|` strike within the ±12-strike NEAR window around spot) | `fmtPx(magnet.strike, kDp)` | none | `"—"` when no magnet (empty chain/no window) |
| Magnet ES + value line | `es(magnet.strike)`, value = `lvlByStrike.get(magnet.strike) ?? magnet.net` (selected basis, falling back to the OI+Vol structural pick) | `"{ES {n} · }{fmtUsd(value,false)}"` | ES segment omitted when `basis` null | `"—"` when no magnet |
| Magnet distance | `magnet.strike - spot` | `fmtPts(...)` | plain mono, no colour rule | `"—"` when no magnet |
| Magnet pill | `\|magnet.strike - spot\| <= pinEps` | Pill badge | within `pinEps` → `"pinning"`; else `"magnet"` | `"—"` shown instead of a pill when no magnet |
| Magnet migration line | `migration.magnet` = gamma Δ at the magnet strike, OI-basis baseline vs. selected-basis live | `MigLine` tag + was/now/pct | `flipped` → `"flipped +γ"`/`"flipped −γ"` (`.flipt`, violet, by current sign); else `\|now\|>=\|was\|` → `"building"` (`.up`); else `"eroding"` (`.warnt`) | Line absent when `migration.magnet` is null |
| **Spot tile — price** | `spot` | `fmtPx(spot, pxDp)` | none | `"—"` if spot ≤0 |
| Spot ES/change line | SPX: `esFut` + `esQ.pct` (`/api/quotes-batch`); non-SPX: `symQ.change`/`symQ.pct` (`/api/quotes-batch`, that ticker's quote) | SPX → `"ES {fmtPx(esFut,2)}{ · pct}"`; non-SPX → `"{±n.nn}{ · pct}"` | none (plain) | Non-SPX shows `"—"` for the change figure when `symQ.change` is null |
| Spot dist-row text | `openLabel` (client, `toOpen = RTH_OPEN_MIN - viewMin`) | Muted mono text (not a points value) | `frozen` → "session closed"; `toOpen>0` → `"RTH open in {h}h {mm}m"`; `viewMin<RTH_CLOSE_MIN` → "RTH open"; else "after the close" | n/a — always one of the 4 strings |
| Spot migration line | `migration.spot` = `moved(baseline.spot, spot)` — the overnight gap vs. the baseline's settle | `MigLine`: tag + `"was {px} → {px} · {fmtPts(move)}"` | `\|move\|<pxEps` → `"flat o/n"` (no colour class); `move>0` → `"gap up"` (`.up`, green); else `"gap down"` (`.down`, red) | Absent when `migration.spot` is null (no baseline) |
| **Max Pain tile — category badge** | `isZeroDte` | `"0DTE"` or `"front"` | Only conditional `<em>` badge among the six tiles | n/a |
| Max Pain price | `maxPain` (client: classic max-pain scan — strike minimizing total ITM OI-value — over `chain`, requires ≥5 strikes with OI) | `fmtPx(maxPain, kDp)` | none | `"—"` if <5 qualifying strikes |
| Max Pain ES/basis line | `es(maxPain)` | `"ES {n}"` when available, else static `"OI-weighted"` | none | Falls to `"OI-weighted"` label rather than a dash when no ES basis |
| Max Pain distance | `maxPain - spot` | `fmtPts(...)` | `>=0` → `chg-pos`; else `chg-neg` | `"—"` if `maxPain` null |
| Max Pain pill | `maxPain`, `spot` | Pill | `maxPain > spot` → `"drift ↑"`; else `"drift ↓"` | `"—"` shown as the pill content when `maxPain` null |
| Max Pain migration line | — | — | **Deliberately none.** Max pain needs per-side OI; the baseline only stores net GEX per strike, so no "was" line is computed or rendered for this tile | Always absent (by design, not a loading gap) |
| **Gamma Flip tile — price** | `flip` | `fmtPx(flip, kDp)` | none | `"—"` |
| Gamma Flip ES/zero-γ line | `es(flip)` | `"ES {n} · zero γ"` when ES basis available, else static `"zero γ"` | none | n/a |
| Gamma Flip distance | `distFlip` | `fmtPts(distFlip)` | `>=0` → `chg-pos`; else `chg-neg` | `"—"` if null |
| Gamma Flip EM-multiple pill | `em` (client: ATM straddle×0.85, else ATM IV×√(1/252)), `distFlip` | `"{n.n}× EM away"` | `.warn` class (amber) when `\|distFlip\|/em < 0.5` | Pill entirely absent (not rendered) when `em` or `distFlip` is null, or `em<=0` |
| Gamma Flip migration line | `migration.flip` = `moved(baseline.flip, flip)` — a **level** move, shown on every basis tab (baseline's flip is always OI+Vol server-side) | `MigLine`: tag + was/now | `\|move\|<pxEps` → `"held"` (no colour); else `"rose {n}"`/`"fell {n}"` (`.flipt`, violet either direction) | Absent when `migration.flip` null |
| **Put Wall tile — name** | Static | `"Put Wall"` + badge `"support"` | none | n/a |
| Put Wall price | `putWall` | `fmtPx(putWall, kDp)` | none | `"—"` |
| Put Wall ES + $ line | `es(putWall)`, `wallGex.put` (`lvlByStrike.get(putWall)`) | `"{ES {n} · }{fmtUsd(wallGex.put,false)}"` | ES segment omitted when `basis` null | `"—"` if `wallGex.put` null |
| Put Wall distance | `distPut = putWall - spot` | `fmtPts(distPut)` | `>=0` → `chg-pos`; else `chg-neg` | `"—"` if null |
| Put Wall pill | `overnight.lo`, `putWall`, `basis` | Pill | `overnight.lo <= putWall + basis` → `"ON low tagged"` (`.pill.hot`); else `"untested"` (`.pill.cool`, green-tinted) | Always renders one of the two |
| Put Wall migration line | `migration.putWall`, tag via `wallState()` — read on **magnitude**, since a put wall's gamma is negative (a more-negative number = a heavier floor) | `MigLine`: tag + was/now/pct + optional "wall moved…" note | `wallState`: flipped sign → `"flipped sign"` (`.flipt`); `\|pct\|<2%` → `"unchanged"`; magnitude grew → `"deepening"` (`.down`, i.e. strong-label variant maps to the "down" class here); shrank → `"easing"` (`.warnt`) | Line absent when no gex Δ and no px move |

**Sort order.** The six tiles render in a fixed DOM order — Call Wall, 0DTE Magnet, Spot, Max Pain, Gamma Flip, Put Wall — not sorted by value; this is a `grid-template-columns:repeat(6,1fr)` row (collapses to 3-per-row under 1180px).

---

# Part 2 — GEX profiles, overnight, GEX changes, sector heat, expected range, catalysts, footer

Scope: `components/pages/Premarket.tsx` (~3356 lines) + `components/pages/premarket/GexProfile.tsx` (378 lines), sections A–G only. Supporting derivations traced through `components/pages/premarket/chainGex.ts`, `lib/calculations/calculations.ts`, `hooks/useEsCandles.ts`, `hooks/useEtfCandles.ts`, `hooks/useEconCalendar.ts`, `lib/econCalendar.ts`.

Conventions used below: `fmtUsd(v, signed=true)` = Premarket.tsx's own formatter — `±$1.92B` / `±$840M` (0dp) / `±$12.4K` (1dp) / `±$840` (0dp), `—` if null/NaN, uses `−` (U+2212) not `-`. `fmtPx(v, dp)` = `nf(v, dp)` or `—` if null/≤0. `fmtPct(v, dp=2)` = `±x.xx%` or `—`. `nf(v, dp)` = `toLocaleString` with fixed dp, no sign, no `$`. `kDp` = strike decimals inferred from the ladder's own min strike step (0 if step≥1, 1 if 0.5≤step<1, 2 if step<0.5; falls back to `spot≥1000?0:2` when the ladder is empty). `pxDp` = `spot>=1000 ? 0 : 2`.

---

### A. GEX PROFILE BY STRIKE (front expiry) and GEX PROFILE · EX-0DTE

One component (`GexProfile.tsx`) mounted twice in `Premarket.tsx`'s `<div className="body two">` (row 3). Both instances share every formatter/behaviour below; differences are called out per row.

| Label as shown | Source (hook / API path + field, or the client-side derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "GEX Profile by Strike" (card title) | Literal string, `title` prop on 1st `<GexProfile>` mount | Static text | none | always rendered |
| Front sub-header (e.g. "0DTE 2026-08-30 · OI + Vol · scroll") | Client string template: `` `${isZeroDte?"0DTE":"front"}${expiry?` ${expiry}`:""} · OI + Vol · scroll` ``; `isZeroDte`/`expiry` destructured from `gex` (= `useMobileGex` for SPX / `frozenGexOf` for a frozen or replayed session / `useChainGex` for any other ticker) | Plain text, no decimals | none | n/a — always has a value once `gex` resolves |
| "GEX Profile · ex-0DTE" (card title) | Literal string, `title` prop on 2nd `<GexProfile>` mount | Static text | none | always rendered |
| Ex-0DTE sub-header (e.g. "all 47 expirations less 0DTE · OI + Vol · scroll") | `multiGex.expiryCount` from `useMultiExpiryGex(sym, spot, !frozen && !replay)` → `/proxy/gex-by-strike-multi?symbol=&spot=` `expiryCount` field | `` `all ${N} expirations less 0DTE · OI + Vol · scroll` `` when `expiryCount>0`, else `"all expirations less 0DTE · OI + Vol"` (no count, no "· scroll") | none | falls to the count-less string when `expiryCount` is 0/absent |
| Per-row strike label (`.k` column) | Front: `perStrike` = `chain.map(r => ({strike:r.strike, net: netGEXOf(r,"net",spot)}))`, `chain` = `gex.chain` (raw legs). Ex-0DTE: `exRows = multiGex.ex0dte.rows`, each row's `net` server-presummed as `netGEX + netVolGEX` per `chainGex.ts`'s `ladderOf` | `nf(strike, kDp)` — no `$`, no sign | Row gets class `key` (bold, `--txt` colour) when `tagFor`/`tagForEx` returns a badge for that strike; otherwise dim (`--dim`) | strike omitted entirely if `!Number.isFinite(strike)` or `!Number.isFinite(net)` (filtered before windowing) |
| Per-row bar | Same `net` value as strike label. Width = `(abs(net)/(net>=0?maxP:maxN))*50` of track (each side maxes at 50%); `maxP`/`maxN` = largest +/− `net` **within the NEAR window only** (±12 strikes around spot, `NEAR_HALF=12`), not the full ±60 rendered window | Horizontal bar, gradient `--posDim→--pos` (call/positive) or `--negDim→--neg` (put/negative), right-anchored at centre for negative, left-anchored for positive | Bar gets class `dimmed` (opacity .45) when `abs(net) ≤ bigCut`, where `bigCut = max(maxP,maxN)*0.55` (again NEAR-window scale) | a strike with `net` exactly 0 renders a zero-width bar, not hidden |
| Tag: CALL WALL | Front: `strike === callWall` (`gex.callWall`). Ex-0DTE: `strike === ex0.callWall` (`multiGex.ex0dte.callWall`, server's own wall for the ex-0DTE ladder) | `"CALL WALL"` badge, bordered pill, colour `var(--cw)` (= `ES_CANDLE_UP` token) | Checked FIRST in `tagFor`/`tagForEx`'s if-chain — wins over Put Wall/Magnet/Max Pain/Flip if a strike somehow matches more than one | not shown if `callWall`/`ex0.callWall` is null |
| Tag: PUT WALL | Front: `strike === putWall`. Ex-0DTE: `strike === ex0.putWall` | `"PUT WALL"` badge, colour `var(--pw)` (= `ES_CANDLE_DOWN`) | 2nd priority in the if-chain | not shown if wall is null |
| Tag: 0DTE MAGNET | Front ladder ONLY — `strike === magnet.strike`; `magnet` = biggest `abs(net)` strike within the NEAR (±12) window | `"0DTE MAGNET"` badge, colour `var(--violet)` (`#a78bfa`) | 3rd priority; not present on the ex-0DTE ladder at all (`tagForEx` has no magnet branch) | not shown if `nearBars` is empty |
| Tag: MAX PAIN | Front ladder ONLY — `strike === maxPain`; `maxPain = computeMaxPain(chain)` (classic max-pain, ITM OI-value minimum, needs ≥5 OI-bearing rows) | `"MAX PAIN"` badge, colour `var(--blue)` | 4th priority; absent from ex-0DTE ladder | not shown if `computeMaxPain` returns null (<5 qualifying strikes) |
| Tag: GAMMA FLIP | Front: nearest listed strike to `flip` (`gex.flip`, from `findGEXFlip` for live/chain-poll or the frozen payload). Ex-0DTE: nearest listed strike to `ex0.gexFlip` (server value) | `"GAMMA FLIP"` badge, colour `var(--amber)` (`HT.orange`) | 5th/last priority on both ladders | not shown if flip is null or no strike matches |
| Tag placement (inside vs. outside bar) | Client layout rule in `GexProfile.tsx`: `inside = w>=22` (bar ≥22% of half-track) | Inside: right/left-aligned flush to the bar's far end, dark plate background (`rgba(6,10,16,.55)`), white text, no colour border. Outside: hangs past the bar's tip, `var(--plate)` background, coloured border/text matching the tag's own colour | n/a | n/a |
| Axis low readout | `fmtUsd(-maxN, false)` — `maxN` = largest negative `net` in the NEAR (±12) window, same scale the bars use | `$` scaled B/M/K, unsigned (2nd arg `false` suppresses the `+`) even though the value is the negative side | none | shows `$0` equivalent (`fmtUsd(-1,false)`→"$1", since `maxN` floors at `Math.max(1,…)`) when no negative bars exist in the window |
| Axis centre readout | Literal `"0"` | Plain text | none | always shown |
| Axis high readout | `fmtUsd(maxP, false)` — largest positive `net` in the NEAR window | Same as axis-low | none | floors at `Math.max(1,…)` when no positive bars |
| "⤒ back to spot" recenter button | Client scroll state (`pinned` in `GexProfile.tsx`) | Button text `"⤒ back to spot"` | Rendered only when `!pinned && bars.length>0` — i.e. the reader scrolled the ladder away from spot (a real wheel/touch/drag/key gesture within 700ms of the scroll event un-pins it; programmatic/browser-caused scrolls do not) | absent while pinned or while the ladder is empty |
| SPOT line | `spot` prop (`gex.spot`); positioned at the row of the nearest listed strike to `spot` | Dashed line across the chart, label `"SPOT " + fmtPx(spot, pxDp)`, white (`#fff9` line / `#fff` text) | none | line/label absent when no strike in the rendered ±60 window matches (`spotStrike` null) or `spot<=0` |
| FLIP line | Front: `flip` prop. Ex-0DTE: `ex0?.gexFlip ?? null` | Dashed amber line, label `"FLIP " + fmtPx(flip, kDp)` — note: uses **kDp** (strike precision), not pxDp like the SPOT label | colour `var(--amber)` | line/label absent when `flip` is null/falsy or no matching strike in the ±60 window |
| DEX stat tile (front ladder's `children`) | `totals.dex` = Σ `netDEXOf(r,"net",spot)` over every row of `chain` (`lib/calculations.ts`) | `fmtUsd(totals.dex)` — signed, $B/M/K | value class `chg-pos` if `dex>=0` else `chg-neg`; sub-line `"calls leading · tilt ↑"` if `dex>=0` else `"puts leading · tilt ↓"` | `dex` defaults to 0 (sums over empty chain), so tile shows `+$0` rather than a dash when chain is empty |
| VANNA stat tile | `totals.vanna` = Σ `(r.netVanna ?? 0) + (r.netVolVanna ?? 0)` but ONLY if at least one row carries `netVanna`/`netVolVanna` (`anyVanna` flag); else `null`. Per `chainGex.ts`, non-SPX rows only carry vanna when the chain payload itself has a per-side `vanna` field | `fmtUsd(totals.vanna)` | class `chg-pos`/`chg-neg` by sign, or no class if null; sub-line `"no per-contract vanna on this feed"` when null, else `"vol down helps ↑"` (vanna≥0) / `"vol down helps ↓"` | shows `"—"` (via `fmtUsd(null)`) with the "no per-contract vanna" sub-line when the feed carries none — this is the expected state for most non-SPX tickers per `chainGex.ts`'s header |
| Call / Put Γ stat tile | `totals.callGex` = Σ `callGEXOf(r,"net",spot)`; `totals.putGex` = Σ `putGEXOf(r,"net",spot)` | `fmtUsd(callGex,false)` (green) `" / "` `fmtUsd(abs(putGex),false)` (red) — both unsigned magnitudes | call value fixed `chg-pos`, put value fixed `chg-neg` (not sign-conditional — put is definitionally negative); sub-line `"call side heavier"` if `abs(callGex)>=abs(putGex)` else `"put side heavier"` | 0 for an empty chain, not a dash |
| Net GEX · whole board (ex-0DTE ladder's `children`) | `multiGex.all?.totalNetGex` — server field from `/proxy/gex-by-strike-multi`'s `all.totalNetGex`, via `ladderOf` | `fmtUsd(...)` | class `chg-pos` if `(value ?? 0) >= 0` else `chg-neg` (so a null value still renders green); sub-line static `"every listed expiration"` | `fmtUsd(null)` → `"—"` when `multiGex.all` hasn't loaded |
| Net GEX · ex-0DTE | `ex0?.totalNetGex` (`multiGex.ex0dte.totalNetGex`) | `fmtUsd(...)` | class `chg-pos`/`chg-neg` same rule as above; sub-line `"no standing book yet"` if null, else `"the book underneath dampens"` (≥0) / `"the book underneath amplifies"` (<0) | `"—"` when not yet loaded |
| Leaves at the bell | Client subtraction: `multiGex.all.totalNetGex - ex0.totalNetGex`, only when BOTH are non-null | `fmtUsd(...)` | **no colour class at all** (plain `v mono`, unlike the two tiles beside it) — this is the one tile in the trio that never turns green/red; sub-line static `"the front tranche's share of the net"` | literal `"—"` (not `fmtUsd(null)`, a hand-written fallback) when either total is missing |
| Front ladder empty state | `bars.length === 0` inside `GexProfile.tsx`; front mount does not override the `empty` prop | Default text `"Waiting for the chain…"`, centred, `--dim` colour, `40px 0` padding; the fixed-height/padding box itself is skipped (only the message renders) | none | this IS the empty state |
| Ex-0DTE ladder empty state | `bars.length === 0`; `empty` prop passed explicitly, 4 branches keyed on `frozen`/`replay`/`multiGex.state` | `"The whole-board sweep reads the live chain, so there is no version of it for a past session."` (frozen or replay) → `"The whole-board sweep did not answer."` (`state==="error"`) → `"Nothing but 0DTE listed on this board."` (`state==="empty"`) → `"Sweeping every expiration…"` (default/loading) | none | as above |

**Sort order (both ladders):** strikes ascending by price, then the caller's `windowAt(half)` slices `spotIdx∓half` and `.reverse()`s the slice — so the RENDERED order is **descending strike, highest at top**. Front ladder windows ±60 strikes (`VIEW_HALF`) around the nearest strike to spot; ex-0DTE ladder windows the same ±60 over its own `exRows`. The NEAR window (±12, `NEAR_HALF`) used only for bar-scale/tag lookups is a subset of the same ordering, not separately sorted.

**Scroll behaviour (both ladders, not a rendered value but governs what's on screen):** panel is pinned/centred on spot by default; a real wheel/touch/drag/keydown within 700ms of a scroll event un-pins it (browser-caused scrolls, e.g. from a symbol swap clearing rows, do not un-pin); `resetKey` (`` `${sym}|front` `` / `` `${sym}|ex0dte` ``) changing (i.e. symbol switch) forces re-pin and re-centre. Centring retries via `requestAnimationFrame` up to ~90 frames and again on any `ResizeObserver` box-size change.

---

### B. OVERNIGHT CONTEXT

| Label as shown | Source (hook / API path + field, or the client-side derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "Overnight Context" (card title) | Literal string | Static text | none | always rendered |
| Header range readout | Client template: `` `${sym==="SPX" ? "ES · 18:00" : `${sym} · ext`} → ${HH}:${MM} ET` ``, `HH:MM` = `Math.floor(etMin/60)` / `etMin%60` zero-padded, `etMin` from `etWall()` (device clock read via `Intl` in America/New_York) | Plain text | SPX shows `"ES · 18:00"` (Globex open); every other symbol shows `"{sym} · ext"` (its own extended session) | none — etMin always resolves |
| ON low caption | `overnight.lo` — min `low` of ES/ETF candles from `useEsCandles`'s `sessionCandles`/`historical` (SPX) or `useEtfCandles` rows (`symCandles`, non-SPX) merged via `candlePool`, restricted to the pre-RTH/evening window (`minOf(slotKey) < RTH_OPEN_MIN` on today or `≥18:00` on `evDate`) | `fmtPx(overnight.lo, pxDp)`, label `"ON low "` prefix | fixed at `left:12%` position, colour `var(--pos)` (green, i.e. the low is drawn in the "up" colour by convention of this bar) | entire `.onrange` block falls to the "No overnight bars yet." text (see below) if `overnight.lo`/`overnight.hi` is null |
| ON high caption | `overnight.hi` — max `high` over the same window | `"ON high " + fmtPx(overnight.hi, pxDp)` | `left:88%`, colour `var(--neg)` (red) | as above |
| Range bar fill | Static track between 12%–88% | Gradient fill `--blueFill1→--blueFill2` | none | n/a |
| Put-wall-colour marker (ON low tick) | Positioned at 12% (fixed, not computed from price) | 2px tick, background `var(--pw)` | none | n/a |
| Call-wall-colour marker (ON high tick) | Positioned at 88% (fixed) | 2px tick, background `var(--cw)` | none | n/a |
| Live marker + label | `livePx` = `sym==="SPX" ? esFut : spot` (ES future for SPX since cash SPX doesn't trade overnight; the symbol's own live price otherwise), positioned via `onPos(livePx)` (% within the ON band, ±18% padding each side) | Tick (white, taller: height 34) + label `` `${sym==="SPX"?"ES":sym} ${fmtPx(livePx,pxDp)}` `` | white marker/text | not rendered if `onPos(livePx)` returns null (band undefined or `livePx` outside computable range) |
| PDC marker + label | `overnight.pdc` (prior session's last RTH 16:00 close), positioned via `onPos(overnight.pdc)` | Tick + label `"PDC " + fmtPx(overnight.pdc, pxDp)`, colour `var(--dim2)` | dim/neutral colour, no threshold | not rendered if `onPos` returns null |
| Overnight empty state | `overnight?.lo == null \|\| overnight?.hi == null` | `"No overnight bars yet."`, `--dim`, 18px top padding | none | this IS the empty state, replaces the whole `.onrange` visual |
| Stat: ES change | `quotes["/ES"]` from `/api/quotes-batch?symbols=SPX,/ES,/NQ,VIX[,{sym}]` → fields `change`, `percent-change` | `` `${sign}${abs(change).toFixed(2)} (${fmtPct(pct)})` `` — sign written manually AND `fmtPct` writes its own sign (so e.g. `"+4.20 (+0.06%)"`) | value class `chg-pos`/`chg-neg` on `(change??0)>=0` | `"—"` when `esQ?.change` is null |
| Stat: NQ change | `quotes["/NQ"]`, same batch call | Same format as ES change | Same rule | `"—"` |
| Stat: ON range | `onRange = overnight.hi - overnight.lo` when both present | `` `${nf(onRange, pxDp)} pts` `` | none | `"—"` if either bound missing |
| Stat: Prior RTH close (SYM) | `overnight.pdc`; label suffix `(ES)` if `sym==="SPX"` else `(sym)`; session name appended via `sessionLabel(overnight.pdDate)` (e.g. names it "FRIDAY" over a weekend rather than "yesterday") | `fmtPx(overnight.pdc, pxDp)` | date-name shown in `--muted` beside the label, only when `overnight.pdDate` is set | `"—"` when `pdc` is null |
| Stat: VIX | `quotes["VIX"]` (`.last`, `.change`) from the same batch call | `vixQ.last.toFixed(2)` then a signed delta `${sign}${abs(change).toFixed(2)}` | delta class is INVERTED vs. every other change row: `chg-neg` when `change>=0`, `chg-pos` when `change<0` (VIX up = bearish) | `"—"` for the level; the delta span is omitted entirely (not even a dash) when `vixQ?.change` is null |
| Stat: Gap (label + value + pill) | `gap` memo: `pdc=overnight.pdc`, `openPx=overnight.openPx` (today's 09:30 print), `ref = openPx ?? livePx`; `pts=ref-pdc`, `pct=pts/pdc*100`, `flat = abs(pts)<gapEps` (`gapEps=max(0.01, spot*0.00004)`), `filled` from RTH lo/hi crossing `pdc` | Label toggles `"Gap (projected)"` (before 09:30 print) vs `"Gap (4pm → 9:30)"` (after). Value: `"flat"` (muted) or `` `${sign}${abs(pts).toFixed(2)} (${fmtPct(pct)})` `` (chg-pos/neg by `up`) | Pill states, in priority order: `✓ FILLED` (cool/green) if `gap.filled`; else `"projected · pre-open"` (neutral) if `gap.projected`; else if `gap.outside==null` → `"gap up"`/`"gap down"` (neutral pill); else `"outside PD range"`/`"inside PD range"` (outside = warn/amber pill, inside = neutral) | whole stat shows `"—"` when `gap` itself is null (no `overnight.pdc`); row gets class `gap-filled` (label turns `--pos` green) once `gap.filled` |
| Stat: Gap fill target | Same `gap` memo — `remaining = filled?0:(pdc-last)`, `retrace` = % of gap closed | `"—"` if no gap or `gap.flat`; `` `✓ filled at ${fmtPx(pdc,pxDp)}` `` (green) if filled; else `` `${fmtPx(pdc,pxDp)} (${nf(abs(remaining),pxDp)} pts up/down [· N% retraced])` `` | `gap-filled` class on the row once filled | `"—"` |
| Gap progress bar | Same `gap` memo, rendered only when `gap && !gap.flat && !gap.projected` | Fill width `` `${max(2,min(100, filled?100:retrace??0))}%` ``, colour `var(--pos)` once filled else `var(--blue)`; label `"gap closed"` or `` `${retrace.toFixed(0)}% of the gap retraced` `` | none beyond the fill colour swap on `filled` | bar entirely absent (not shown as empty) when `gap` is null, flat, or still projected |
| Stat: Prior day range (SYM) | `overnight.pd` = `{hi, lo}` from the prior RTH session's candles; label suffix `(ES)`/`(sym)` same rule as PDC row | `` `${fmtPx(pd.lo,pxDp)} – ${fmtPx(pd.hi,pxDp)} (${nf(pd.hi-pd.lo,pxDp)})` `` (span in muted parens) | none | `"—"` when `overnight.pd` is null |

`sym==="SPX"` note: ES-labelled rows (header sub, live marker label, "Prior RTH close (ES)", "Prior day range (ES)") read the ES future / ES candle series specifically for SPX; for every other ticker these same rows read that ticker's own extended-session candles (`useEtfCandles`) and its own last price, and the label swaps to the symbol name instead of "ES".

---

### C. BIGGEST GEX CHANGES

| Label as shown | Source (hook / API path + field, or the client-side derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "Biggest GEX Changes" (header) | Literal string | Static text | none | always rendered |
| Basis note (sub-header) | `` baseline ? `vs ${baseline.date} close · OI basis` : "vs prior close" ``; `baseline` from `/api/premarket-baseline?expiry=&basis=oi&symbol=[&today=]` | Plain text | none | falls to the generic `"vs prior close"` while `baseline` hasn't loaded |
| Row: strike label | `strikeDeltas[i].strike` — from `perStrikeOi` (`oiLeg(row,spot)` = OI-only leg, i.e. `netGEXOf(r,"net",spot) - netGEXOf(r,"vol",spot)`) matched against `baseline.byStrike[String(strike)]`; rows where the baseline never listed that strike are SKIPPED (not treated as 0) | `nf(strike, kDp)` | none | n/a |
| Row: bar | `delta = live OI leg − baseline OI value`; width `= (abs(delta)/mx)*50` where `mx = max(abs(delta))` across the shown (≤4) rows | Half-bar, left-anchored positive (`var(--pos)`), right-anchored negative (`var(--neg)`) | colour purely by sign of `delta` | n/a |
| Row: value | Same `delta` | `fmtUsd(delta)` — signed, $B/M/K | text class `chg-pos`/`chg-neg` by sign | n/a |
| Empty/loading state | `strikeDeltas.length === 0`, branched on `baselineState` | `"Loading the prior-close board…"` (`loading`/`idle`) → `` `No prior-session board for ${sym} ${expiry||"this expiry"} yet — server-v2/premarket-baseline.js records one at 16:05 ET each session (and its ALLOWED_SYMBOLS list gates which symbols it will sweep), so this fills in after the next close.` `` (`empty`) → `"No strike moved against the prior close."` (baseline present but every delta computed to 0 or nothing matched) | none | this covers all 3 non-data states |

**Sort order:** `strikeDeltas` filtered to `delta !== 0` and baseline-matched strikes, then `.sort((a,b) => abs(b.delta) - abs(a.delta))`, `.slice(0,4)` — **absolute value descending, top 4 only**, mixed sign (no separation of gainers/losers).

---

### D. SECTOR HEAT

| Label as shown | Source (hook / API path + field, or the client-side derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "Sector Heat" (header) | Literal string | Static text | none | always rendered |
| Sub-header | Literal string `"Market Quality · 5d %"` | Static text | none | always rendered |
| Row: sector name + ticker | `sectorRows[i].name`, `.symbol` — from `/api/scanner/market-quality`'s `data.sectorBars` (`SectorBar[]`), fetched into `sectors` state and filtered to `Number.isFinite(chg5d)` | `` `${name} ${symbol}` ``, symbol in `--muted` | none | n/a |
| Row: value (5d %) | `s.chg5d` — same `sectorBars` payload, "5-day sector change" | `fmtPct(chg5d)` (signed, 2dp) | text class `chg-pos`/`chg-neg` by sign; row's own background/border tint: `a = min(0.35, abs(chg5d)/12)`, colour `rgb(46,204,143)` (green) if `≥0` else `rgb(255,92,108)` (red), `background: rgba(c, a*0.25)`, `border-color: rgba(c, 0.15+a)` — i.e. tint intensity scales continuously with magnitude, capped at a 12%-move ceiling | n/a |
| Empty/loading state | `sectorRows.length === 0` (either `sectors` hasn't loaded, or none carry a finite `chg5d`) | `"Loading sector data…"`, `--dim`, 11px | none | this IS the state shown |

**Sort order:** `sectors` filtered to finite `chg5d`, sorted `chg5d` descending, then `[...top 3, ...bottom 3]` deduplicated by array-identity (`indexOf===i`, guards a <6-row universe from repeating rows) — so the panel shows the **3 biggest gainers followed by the 3 biggest losers**, each sub-group still in descending order (the losers group therefore reads least-negative → most-negative top to bottom).

---

### E. EXPECTED RANGE

| Label as shown | Source (hook / API path + field, or the client-side derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "Expected Range" (header) | Literal string | Static text | none | always rendered |
| Header sub | `` isZeroDte ? "0DTE" : "front" `` | Plain text | none | n/a |
| EM low cap | `emLo = spot - em`; `em` = ATM straddle mid × 0.85 (`(callMark+putMark)*0.85`) if both marks present, else `spot × avgIV × √(1/252)` | `fmtPx(emLo, pxDp)`, `--dim` colour, `left:8%` | none | whole `.onrange` block falls to the "No ATM straddle yet" text if `em`/`emLo`/`emHi` is null |
| EM centre label | `em`, `spot` | `` `EM ±${((em/spot)*100).toFixed(2)}% / ±${nf(em,pxDp)} pts` ``, white, `left:50%` | none | as above |
| EM high cap | `emHi = spot + em` | `fmtPx(emHi, pxDp)`, `--dim`, `left:92%` | none | as above |
| EM band fill | Static 8%–92% track | Gradient `rgba(167,139,250,.25/.5/.25)` (violet, matches EM's own violet elsewhere on the page) | none | n/a |
| Put Wall marker + label (in EM track) | `putWall` (`gex.putWall`), positioned via `emPos(putWall)` | Tick + `"Put Wall"` label, colour `var(--pw)` | none | not rendered if `emPos` returns null (band undefined or `putWall` null) |
| Call Wall marker + label | `callWall` (`gex.callWall`), via `emPos(callWall)` | Tick + `"Call Wall"` label, colour `var(--cw)` | none | not rendered if null |
| Spot marker | `spot`, via `emPos(spot)` | White tick, NO text label | none | not rendered if `emPos(spot)` is null |
| Expected-range empty state | `em==null \|\| emLo==null \|\| emHi==null` | `"No ATM straddle yet — expected move unavailable."`, `--dim`, 18px top padding | none | this IS the empty state |
| Stat: IV-implied move | `em`, `spot` | `` `±${nf(em,pxDp)} pts (${((em/spot)*100).toFixed(2)}%)` `` | none | `"—"` if `em` null |
| Stat: GEX-implied range | `putWall`, `callWall` | `` `${fmtPx(putWall,kDp)} – ${fmtPx(callWall,kDp)} (${nf(abs(callWall-putWall),pxDp)})` `` | none | `"—"` if either wall null |
| Stat: Overlap / conviction | `conviction` = overlap of `[emLo,emHi]` and `[min(putWall,callWall), max(putWall,callWall)]`, as % of the EM band width | `` `${label} ${conviction.toFixed(0)}%` `` | label `HIGH` (chg-pos) if `≥60`; `MEDIUM` (no colour class) if `≥35`; `LOW` (chg-neg) otherwise | `"—"` if `conviction` null (missing EM or wall) |
| Stat: Overnight range | `overnight.lo`, `overnight.hi` (same values as section B) | `` `${fmtPx(lo,pxDp)} – ${fmtPx(hi,pxDp)}` `` | none | `"—"` if either bound missing — **this row duplicates section B's overnight range in a second, differently-scoped card** |
| Stat: Market quality | `mqScore` = `{score: data.globalScore, decision: data.decision}` from `/api/scanner/market-quality` (same call that feeds Sector Heat) | `` `${Math.round(score)} / 100 ${decision}` `` (decision in `--muted`) | class `chg-pos` if `score>=60`, none if `≥40`, `chg-neg` otherwise | `"—"` if `mqScore` not yet loaded |
| "Today's one-liner" (sub-header) | Literal string | Static text, uppercase via CSS `.play .h` | none | always rendered |
| One-liner paragraph | `hasData` (from `gex`); `posGamma = (totalNetGex??0)>=0`; `distFlip=spot-flip`, `distCall=callWall-spot`, `distPut=putWall-spot`; `magnet.strike` | `` `${Positive|Negative} gamma, flip {n pts below/above} pts, Call Wall {n above/below}, Put Wall {n above/below} — {bold verdict}` ``; verdict = `` `fade extremes, scalp toward the {magnet strike|"magnet"} magnet.` `` (positive gamma) or `"stand aside at the edges, trade continuation through the walls."` (negative gamma); `n/a` substituted per-clause when its distance is null | `flip`/`distFlip` etc. in `.k`(amber)/`.r`(red)/`.g`(green) inline spans per the `.play .k/.g/.r` CSS rules | `"Waiting for the first chain frame."` when `!hasData` |
| Scenario bullet: ▲ Above call wall | `callWall`, `magnet`, `posGamma` | `` `Above ${fmtPx(callWall,kDp)} — call wall break. Chase only with DEX confirming; gamma thins out above.` `` | `▲` icon in `.g` (green, `var(--pos)`) | strike prints `"—"` via `fmtPx(null,…)` if `callWall` null; body text is otherwise static |
| Scenario bullet: ◆ base case | `putWall`, `callWall`, `posGamma`, `magnet` | `` `${fmtPx(putWall,kDp)}–${fmtPx(callWall,kDp)} — base case. {Fade the edges, target {magnet\|"the magnet"}. \| Two-sided and fast; size down.}` `` (branches on `posGamma`) | `◆` icon in `.k` (amber, `var(--amber)`) | walls print `"—"` if null |
| Scenario bullet: ▼ Below flip | `flip`, `putWall` | `` `Below ${fmtPx(flip,kDp)} — flip breached, regime turns negative. Stop fading; trend short toward ${fmtPx(putWall,kDp)}.` `` | `▼` icon in `.r` (red, `var(--neg)`) | values print `"—"` if null |

---

### F. CATALYSTS

| Label as shown | Source (hook / API path + field, or the client-side derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "Catalysts" (header), sub "today" | Literal strings | Static text | none | always rendered |
| Empty state | `todayEvents.length===0 && todayEarnings.length===0` | `"Nothing scheduled on the US calendar today."`, `--dim`, 11px | none | this IS the state |
| Event row: time pill | `e.time_formatted \|\| e.time` — `useEconCalendar({withQuote:false})` → `/api/calendar` events, filtered client-side (`todayEvents`) to `date===viewDate && country==="USD" && impact in {High,Medium,President}`, sliced to first 4 | Pill, `h:MM AM/PM` (ET) | pill class `hot` (red) if `impact==="High"`; `warn` (amber) if `"Medium"`; no class (neutral/`--dim`) for `"President"` (the filter admits President but the pill styling only branches on High/Medium) | n/a |
| Event row: title | `e.title` | Plain text beside the pill | none | n/a |
| Event row: forecast/actual | `e.actual`, `e.forecast` | `` `act ${actual}` `` if `actual` present, else `` `exp ${forecast}` `` if `forecast` present, else `"—"` | `--muted mono` | `"—"` |
| Event row staleness fade | `isStale(e, calNow)` from `lib/econCalendar.ts` — true when the event's ET date is in the past, OR same date and `nowMinutes - eventMinutes > 30` | Row `opacity: 0.5` when stale, `1` otherwise | 30-minute cutoff past the scheduled time; no fade for future events | n/a |
| Earnings row: session pill | `r.session` — `useEconCalendar`'s `earnByDate` (narrowed via `pickAnticipated`/`groupEarningsByDate` in `lib/econCalendar.ts`) → `/proxy/earnings-week?week=both`; `todayEarnings` = `[...bucket.pre, ...bucket.after]` for `viewDate`, sorted by `market_cap` desc, sliced to 2 | Pill `"PRE"` (`session==="pre"`) or `"AMC"` (else, i.e. `"after"` — the row list only ever contains pre/after since `tbd` is never concatenated in) | plain pill, no colour class | n/a |
| Earnings row: symbol + label | `r.symbol` | `` `${symbol} earnings` `` beside the pill | none | n/a |
| Earnings row: EPS | `r.eps_est` | `` `EPS ${eps_est}` `` if present else `"—"` | `--muted mono` | `"—"` |

**Sort order:** events — filtered to `viewDate`/USD/High·Medium·President, taken from the calendar hook's own list which is pre-sorted `date` then `time` ascending (so chronological within the day), first 4 kept. Earnings — bucketed by `pre`/`after` (the `tbd`/unconfirmed-time bucket is never rendered here), sorted market-cap descending, first 2 kept, `pre` entries preceding `after` entries because the spread `[...pre, ...after]` is built before the sort (the sort itself is stable across the concatenation, so within-cap ties keep pre-before-after order... note the sort key is cap only, so a large `after` name can still rank above a smaller `pre` name).

---

### G. FOOTER status bar and baseline / expiry chips

| Label as shown | Source (hook / API path + field, or the client-side derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Session date | `viewDate` = `replay\|\|frozen ? sessionDate : etDate` | Raw `YYYY-MM-DD` string, no reformatting | none | n/a |
| Symbol | `sym` | Raw ticker string | none | n/a |
| Feed label | `feedLabel`: `` replay ? `REPLAY ${etClockOf(viewMin)} ET` : sym!=="SPX" && !frozen ? (connected?"CHAIN POLL · 1m":"CHAIN POLL · retrying") : source==="live" ? (connected?"LIVE":"RECONNECTING") : source==="rest" ? "REST FALLBACK" : "PAUSED" `` — `connected`/`source` from `gex` (`useMobileGex`/`useChainGex`) | Plain text | 6 mutually exclusive states as listed | n/a — one branch always matches |
| Spot | `spot` (`gex.spot`) | `fmtPx(spot, 2)` — **fixed 2dp regardless of symbol**, unlike `pxDp`-driven spot displays elsewhere on the page | none | `"—"` if `spot<=0` |
| ES | `footEs = sym==="SPX" ? esFut : (esQ?.last ?? 0)` — `esFut` from the socket's `aux` frame (SPX only, 0 on the chain-poll path per `chainGex.ts`); `esQ` = `/api/quotes-batch` `/ES` quote | `fmtPx(footEs, 2)` — fixed 2dp | none | `"—"` if `footEs<=0` |
| Basis | `basis` (`gex.basis`) — non-null **SPX-socket-only**; always `null` for `useChainGex`-sourced tickers per that hook's header ("no ES future stands behind an arbitrary ticker") | `` ` · basis ${sign}${abs(basis).toFixed(2)}` `` when non-null | none | segment omitted entirely (not even a dash) when `basis==null` |
| Strike count | `chain.length` | `` `${N} strikes` `` | none | `0 strikes` when chain empty (not hidden) |
| Updated timestamp | `updatedAt` (`gex.updatedAt`, epoch ms) | `new Date(updatedAt).toLocaleTimeString("en-US",{timeZone:"America/New_York",hour12:false})` + `" ET"` | none | segment omitted entirely when `updatedAt` is null |
| Expiry chip | `isZeroDte`, `expiry` | `` `${isZeroDte?"0DTE":"FRONT"} ${expiry||""}` ``, chip class always `"on"` (active/highlighted styling) | always the "on"/active chip style | n/a |
| Baseline chip | `baseline` (`/api/premarket-baseline`), `baselineState` | `` `baseline ${baseline.date} · ${baseline.strikes} strikes · OI` `` when `baseline` present; else `"no baseline"` (`baselineState==="empty"`) or `"baseline loading…"` (otherwise) | plain (non-"on") chip style in all 3 states | the 2 fallback strings above ARE the empty/loading states |

---

# Part 3 — Gamma bell curve, gamma book churn, contracts

Scope: three cards on the v2 `/premarket` dashboard page. Sources read in full:
`GammaBellCurve.tsx` (~790 ln), `gammaChartKit.ts` (~670 ln), `GexHeatBar.tsx`
(`GexChurnHistory` export), `CbContracts.tsx` (~645 ln). Mounting/props skimmed
from `Premarket.tsx`.

No code, no recommendations — this is a checklist of every rendered value.

---

### A. GAMMA BELL CURVE (`GammaBellCurve.tsx`)

**Mounted** in `Premarket.tsx` (~line 3102) as
`<GammaBellCurve chain spot expiry isZeroDte flip callWall putWall frozen={frozen||replay} axisAnchor={replayAxisAnchor} />`.
`chain`/`spot`/`flip`/`callWall`/`putWall`/`expiry`/`isZeroDte` are computed
upstream of this file (out of scope); `frozen` is true on a captured or
replayed session; `axisAnchor` pins the window during replay.

**FULL BAND vs WINDOW — load-bearing distinction for this card:**
The fit (`a`, `mu`, `sigma`, `lsq`), the moment centre (`com`), `insidePct`,
`totalMass`, `netTotal`, and both side-fits (`sideFits.long`/`.short`) are ALL
computed once over `binsFull` — `foldBins(wide)`, the whole ±band
(`wideHalfOf`/`useWideBins`) this card reads. None of the six KPI tiles, the
drawn curves, or the footer prose changes when the user pans or zooms.
Only the drawn BARS (`binsAll`, the window ±2×gridStep of bleed), the two
y-scales, the bar width, and the x-axis domain/ticks (`k0`/`k1`) come from the
current window (`win` / `useStrikeWindow`).

**Sort order:** bins ascending by strike (`useWideBins` sorts `a.k - b.k`
after filtering the chain to `[center-half, center+half]`). Level labels
(wall/flip/spot) are laid out left-to-right by target x-position
(`layoutLevels` sorts by `cx`), not by value.

| Label as shown | Source (hook/API field or derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card title "Gamma Bell Curve" | static `<h3>` text | plain text | none | always shown |
| Sub-header DTE chip | prop `isZeroDte` | "0DTE" or "front" | none | n/a |
| Sub-header expiry | prop `expiry` | ` {expiry}` appended, or omitted | shown only if `expiry` truthy | omitted when `expiry` null/absent |
| Sub-header basis long name | `BASIS_META[basis].long` (gammaChartKit) | "OI + Volume" / "Volume only" | none | n/a |
| Sub-header fit-method tag | client: `fit.lsq` (from `lsqGaussian` over `binsFull`) | " · least-squares fit" or " · moment fit" | shown only when `fit` is non-null | omitted when `fit` is null (empty-state branch renders instead) |
| Sub-header y-scale tag | client state `yScale` (left-gutter drag, `useStrikeWindow`) | " · y ×{yScale.toFixed(2)}" | shown only when `yScale !== 1` | omitted at default 1× |
| Reset button "⤾ reset" | client state `touched` (`view != null \|\| yScale !== 1`) | text "⤾ reset"; title="Back to the Range tab's window and y-scale (or just double-click the chart)" | rendered only when `touched` | absent when untouched |
| Range control group | `ZOOM_META` keys (gammaChartKit): AUTO / ±1% / ±2% / ±3% | segmented buttons, tab labels from `ZOOM_META[z].tab`; each has a `title` hint | active button = `.on` class when `zoom === z && !touched`; `aria-pressed` mirrors it | n/a (always rendered) |
| Basis control group | `BASIS_META` keys: OI+VOL / VOL | segmented buttons, tab labels from `BASIS_META[b].tab`; each has a `title` hint | active button = `.on` class when `basis === b` | n/a |
| KPI 1 "Curve peak" value | client: `mu` = `lsqGaussian(binsFull).mu` — **full band** | `nfp(mu)`, 0dp if spot≥1000 else 2dp | none | tile block not rendered when `fit`/`geo` null (whole card falls to empty state, see below) |
| KPI 1 sub-line ("+/− N vs spot") | client: `mu - spot` | sign prefix (+/−) then `nfp(abs(mu-spot))` + " vs spot" | "+" if `mu >= spot` else "−" | as above |
| KPI 2 "Width 1σ" value | client: `sigma` = `lsqGaussian(binsFull).sigma` — **full band** | "±" + `nfp(sigma)` + " pts" | none | as above |
| KPI 2 sub-line (range) | client: `mu - sigma` … `mu + sigma` | `nfp(mu-sigma)` – `nfp(mu+sigma)` | none | as above |
| KPI 3 "Mass inside 1σ" value | client: `massInside(binsFull, mu, sigma)` — **full band** | `insidePct.toFixed(0)` + "%" | none | as above |
| KPI 3 sub-line (tone text) | client: `insidePct` | one of three phrases | ≥80 "more peaked than normal"; ≥68 "tighter than normal"; else "flatter than normal" | as above |
| KPI 4 "Center of mass" value | client: `com` = `moments(binsFull).mu` (falls back to `g.mu` if moments null) — **full band** | `nfp(com)` | none | as above |
| KPI 4 sub-line | client: `com - spot` | sign + `nfp(abs(com-spot))` + " vs spot" | "+" if `com >= spot` else "−" | as above |
| KPI 5 "Net GEX, board" value | client: `netTotal` = sum of `b.net` over `binsFull` — **full band** | `fmtB(netTotal)` (signed, $B/$M/$K scaling, see gammaChartKit.fmtB) | class `chg-pos` if `netTotal >= 0` else `chg-neg` | as above |
| KPI 5 sub-line | client: `netTotal` sign | "dealers dampen" / "dealers amplify" | pos→dampen, neg→amplify | as above |
| KPI 6 "Gamma mass, total" value | client: `totalMass` = sum of `b.mass` over `binsFull` — **full band** | `fmtB(totalMass, false)` (unsigned) | none | as above |
| KPI 6 sub-line | `BASIS_META[basis].long` | text label, mirrors sub-header basis name | none | as above |
| Top-pane mass gridlines + labels | client: `massTicks = [maxMass, maxMass*0.5]` where `maxMass` from `binsIn` (window) and peak amplitude if in view | `fmtB(v, false)` | tick suppressed if within 11px of the baseline (label-collision guard) | none drawn if `binsIn` empty (empty state) |
| Top-pane baseline "0" label | fixed at `topY1` | text "0" | none | as above |
| Top-pane label "Gamma mass" | static text, halo stroke for legibility over bars | uppercase, 9px | none | always shown when chart renders |
| Mass histogram bars | client: `binsAll` (window ± 2×gridStep bleed) `.mass` per strike | height ∝ mass via `yTop`; width = capped bar width (min of view-spacing and `MAX_BAR_W`=48px) | fill `var(--blue)`; opacity 0.72 for hovered/all-when-no-hover, 0.4 for non-hovered bars when one is hovered | none rendered if `binsIn` empty |
| Fitted mass curve (amber line) | client: `lsqGaussian(binsFull)` Gaussian `a·exp(−(k−μ)²/2σ²)` sampled at 220 pts across the **window** `[k0,k1]` | amber path, 2.2px stroke | drawn at its own amplitude, not normalised to tallest bar; runs off-scale (not clipped-to-fit) when peak `mu` is outside the current window | absent if `fit` null |
| Bottom-pane net gridlines + labels | client: `netTicks = [maxP, -maxN]` (nonzero only) from `binsIn` (window) | `fmtB(v)` (signed) | tick suppressed if within 11px of zero line | none if `binsIn` empty |
| Bottom-pane zero line + "0" label | client: `zeroY` computed from `maxP/(maxP+maxN)` split of **window** bins | line `var(--line3)`; text "0" | none | as above |
| Net GEX bars | client: `binsAll` (window) `.net` per strike | height ∝ signed net via `yNet`; same capped bar width as mass pane | fill `var(--pos)` if `net>=0` else `var(--neg)`; opacity 0.92 (hovered/none-hovered) or 0.5 (dimmed) | none if `binsIn` empty |
| ±1σ shaded band | client: `sigmaL = x(max(k0, mu−sigma))`, `sigmaR = x(min(k1, mu+sigma))` — mu/sigma from **full band**, clipped to window for drawing | rect fill `var(--amberWash)`, spans both panes vertically | none | width 0 if sigma range entirely outside window |
| Long-gamma pane fitted curve | client: `sideFits.long` = `lsqGaussian` over rows where `mass = max(0, net)` — **full band**; ≥5 nonzero bars required else null | dashed amber path, 1.1px, opacity 0.42, dash "7 5" | absent if fewer than 5 bars on the long side, or fit invalid (`a<=0`/`sigma<=0`) | not drawn — no placeholder text |
| Long-gamma pane label | static text + client peak/σ | "long gamma · dealers dampen" + optional " · peak {nfp(mu)} · σ {nfp(sigma)}" when `sideFits.long` present | color `var(--pos)`, halo stroke | peak/σ suffix omitted when no long-side fit |
| Short-gamma pane fitted curve | client: `sideFits.short` = `lsqGaussian` over rows where `mass = max(0, -net)` — **full band**; ≥5 nonzero bars required | dashed amber path, same style as long | absent under the same 5-bar / validity floor | not drawn |
| Short-gamma pane label | static text + client peak/σ | "short gamma · dealers amplify" + optional " · peak {nfp(mu)} · σ {nfp(sigma)}" | color `var(--neg)`, halo stroke | suffix omitted when no short-side fit |
| Put wall marker (line + label) | prop `putWall` | vertical dashed line "3 3"; label "Put wall {nfp(putWall)}" | color `var(--pw)`; leader line to label | omitted entirely if `putWall` null or outside `[k0,k1]` (filtered in `layoutLevels`) |
| Call wall marker (line + label) | prop `callWall` | dashed "3 3"; label "Call wall {nfp(callWall)}" | color `var(--cw)` | omitted if null or off-window |
| Flip marker (line + label) | prop `flip` | dashed "5 4"; label "Flip {nfp(flip)}" | color `var(--violet)` | omitted if null or off-window |
| Spot marker (line + label) | prop `spot` | dashed "6 4"; label "Spot {nfp(spot)}" | color `var(--txt)` | omitted if off-window (spot itself is never null) |
| Hover crosshair | client: `hover` index into `binsIn` | vertical line, `var(--cyan)`, opacity 0.55 | shown only while hovering and not dragging | absent otherwise |
| X-axis strike ticks | client: computed `tickStep` (nice-number step ≥ `(k1-k0)/6`) over **window** | `nfp(t)` per tick | none | n/a |
| X-axis label "Strike" | static | uppercase, letter-spaced | none | always |
| Pan/zoom hint text | static | "scroll=zoom · drag=pan · dbl=reset" | none | always |
| SVG `aria-label` (screen-reader only) | client: `meta.long`, static instructions | "Gamma mass per strike on the {basis long} basis with a fitted normal curve, over a net GEX pane. Scroll to zoom, drag to pan, double-click to reset." | none | n/a |
| Hover tooltip — strike | client: `hv.k` (hovered bin) | `nfp(hv.k)`, bold | none | tooltip absent when not hovering or while dragging |
| Hover tooltip — "mass" row | client: `hv.mass` | `fmtB(hv.mass, false)` | none | as above |
| Hover tooltip — "net" row | client: `hv.net` | `fmtB(hv.net)` (signed) | none | as above |
| Hover tooltip — "fit" row | client: Gaussian evaluated at `hv.k` using full-band `a,mu,sigma` | `fmtB(fittedValue, false)` | none | as above |
| Footer sentence — peak/width | client: `mu`, `sigma` (full band) | "Bell peaks at **{nfp(mu)}** with a 1σ width of **±{nfp(sigma)}** pts ({(sigma/spot*100).toFixed(2)}% of spot);" | none | footer (`<p class="gd-foot">`) not rendered at all in the empty-state branch |
| Footer sentence — mass concentration | client: `insidePct` (full band) | "{insidePct.toFixed(0)}% of the mass is inside it, so the board is {tone}." | ≥80 "far more concentrated than the fitted normal"; ≥68 "tighter than normal"; else "flatter than normal" (**note: wording differs from the KPI-3 sub-line's phrasing for the same thresholds**) | as above |
| Footer sentence — net GEX | client: `netTotal` (full band, despite sentence saying "over the window") | "Net GEX over the window is **{fmtB(netTotal)}**." | none | as above |
| Footer sentence — fallback notice | client: `!lsq` | " Not bell-shaped enough to fit — falling back to the moment curve." | shown only when `lsq === false` | omitted when the least-squares fit succeeded |
| Footer sentence — frozen notice | prop `frozen` (`frozen \|\| replay` from parent) | " Captured session, not live." | shown only when `frozen` true | omitted on a live session |
| **Whole-card empty state** | client: `!binsIn.length \|\| !fit \|\| !geo` | replaces KPI strip + chart + footer with a single centered message in `.gd-empty` | 4-way branch, in order: `chain.length===0` → "Waiting for the chain…"; else `basis==="vol"` → "No volume on this board yet — nothing has traded. Switch to OI+VOL."; else `touched` → "Nothing in this window — double-click to reset the view."; else → "No gamma within ±{pct}% of spot on this basis." (pct = `((wideHalf/spot)*100).toFixed(0)` or `(MAX_BAND*100).toFixed(0)` if spot≤0) | header (title + controls) still renders above the empty message |

---

### B. GAMMA BOOK CHURN — `GexChurnHistory` export (`components/shared/GexHeatBar.tsx`)

**Mounted** in `Premarket.tsx` (~line 3138) as
`<GexChurnHistory symbol={sym} rows={churnRows} note={churnNote} loading={churnLoading} style={{padding:0,borderTop:"none"}} />`
with `{ rows, note, loading } = useGexChurnHistory(sym)` (hook in the same
file), which fetches `GET /api/gex-gross-feed?symbol={sym}&days=45` (default
`days` param of the hook). No `limit` prop is passed, so the component default
(`limit = 12`) is in effect.

**Sort order:** `useGexChurnHistory` returns rows as the API sent them
(oldest→newest per its own `days`-back series). `GexChurnHistory` reverses
that array (`[...rows].reverse()`) so the rendered list is **newest date
first**, then slices to `limit` (12) — i.e. the 12 most recent sessions,
newest at top.

| Label as shown | Source (hook/API field or derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Header title "Gamma book churn" | static text | uppercase, bold, letter-spaced | none | always |
| Header sub-line | prop `symbol` | "how much of {symbol}'s book rewrote itself, session by session" | shown when `symbol` truthy | when `!symbol`: "pick a ticker" |
| Loading line | prop `loading` (from `useGexChurnHistory`'s `setLoading`) | "Loading…" | replaces the whole row list/note area | shown only while `loading === true`, checked before the no-symbol/empty branches |
| No-symbol state | `!loading && !symbol` | renders nothing (no note, no rows) | n/a | body area is empty |
| Empty (no rows) state | `!shown.length` (after slice) | `{note}` if present, else "Nothing on file for {symbol}." | n/a | replaces row list |
| Row date label | API field `date` (YYYY-MM-DD) | `r.date.slice(5)` → "MM-DD" | none | n/a (row only rendered when present) |
| Row heat bar — fill length | API fields `heat`, `churnPct` via shared `heatFill()` | if `heat != null`: `clamp01(heat / 4)` (HEAT_EXTREME=4); else: `clamp01(churnPct / 100)` (provisional) | width = `frac * 100%` | fill still 0-width if `churnPct`/`heat` is 0 |
| Row heat bar — fill colour | API field `buildShare` via `buildShareColor()` diverging ramp | gradient from 0.82-alpha to full-alpha of the same ramped colour | −1 → `ES_CANDLE_DOWN` (full red); 0 → dimmed neutral toward `HOME_THEME.panel` (eased `\|share\|^0.55`, floor 0.4); +1 → `LIGHT_BLUE` (full) | n/a |
| Row heat bar — provisional (hatched) track | `heat == null` (no per-ticker baseline yet) | `repeating-linear-gradient(135deg, …)` hatch pattern on the track background | applied only when `provisional === true` | n/a |
| Row heat bar — dirty-session dimming | API field `clean` | track `opacity: 0.45` | applied when `r.clean === false`; full opacity (1) otherwise (including `clean` undefined) | n/a |
| Row heat bar — tooltip (`title`) | API fields `date`, `churnPct`, `heat`, `buildShare`, `isOpex`/`isEarnings` | "{date} — {round(churnPct)}% of the book changed, {heat.toFixed(1)}× a normal day · build share {buildShare.toFixed(2)}{flag}" | if `heat == null`: "(no baseline yet)" in place of the "×normal" clause | n/a |
| Row right-hand readout | API fields `heat`, `churnPct` | if `heat != null`: `{heat.toFixed(1)}×`; else `{Math.round(churnPct)}%` | text colour = `buildShareColor(buildShare)`, bold | n/a |
| Row flag chip | API fields `isOpex`, `isEarnings` | "OPEX" / "ERN" / empty string | OPEX takes precedence over earnings if both true; **note: abbreviates to "ERN" here vs the full word "EARNINGS" used on the board (`GexHeatBoard`) — a wording divergence between the two surfaces sharing this module** | empty span (no text) when neither flag set |
| Note line (bottom) | prop `note` (from API `note` field, surfaced by the hook) | plain text, small, dim | rendered only when `note` truthy | omitted when no note |
| Row limit | prop `limit`, default 12 (not overridden by the Premarket mount) | caps `shown` to first 12 of the reversed (newest-first) array | none | if fewer than 12 rows exist, all are shown |
| **Legend (pulled off / added gradient bar + "fill = ×normal" caption)** | n/a | **NOT rendered by `GexChurnHistory`** — this legend exists only in the sibling `GexHeatBoard` export in the same file, which is not mounted on `/premarket` | parity gap: a viewer of this card has no on-card key for what the bar colour or hatching means | n/a |
| **Normal/hot tick marks on the bar** | n/a | **NOT rendered by `GexChurnHistory`** — `GexHeatBar` (the board's per-ticker bar) draws `HEAT_NORMAL`/`HEAT_HOT` tick lines on the track; the inline bar built directly inside `GexChurnHistory` does not reuse `GexHeatBar` and omits these ticks | parity gap vs. the board's bar | n/a |

---

### C. CONTRACTS (`CbContracts.tsx`)

**Mounted** in `Premarket.tsx` (~line 3163) as `{!frozen && !replay && <CbContracts />}`
— takes no props; not rendered at all on a frozen or replayed session (entire
card absent, no placeholder). Fetches `GET /api/cb-contracts` on mount and
every 60s (`setInterval`).

**Sort order:** rows render in the order the API returns them in `j.trades`
— no client-side sort. (Per the file's own comment, this is expected to be
checkpoint order 9:45 / 10:30 / 12:00, but `CbContracts.tsx` performs no
sort/validation of that order itself.)

#### C.1 — Card: header, table, footer

| Label as shown | Source (hook/API field or derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card header "Contracts · {session}" | API fields `date`, `today` (from response envelope) via `sessionLabel()` | if no `session` yet: "session"; if `session.today`: "today"; else `sessionLabel(session.date)` → e.g. "Fri Aug 28" (UTC-anchored weekday/month/day) | none | "session" placeholder before first successful load |
| "last session" badge | derived: `session && !session.today` | pill text "last session"; `title`="Today has no checkpoints yet. This flips to today's session on its own as soon as the 9:45 row prints." | amber tone (`var(--amber)` text, amber border/wash) | omitted once `session.today` is true |
| Tiny subtitle line | static text | "0DTE probed at 9:45 / 10:30 / 12:00 · from the CB, walked toward the money to the first strike that qualified · held and re-priced to the bell" | none | always shown |
| Table header row | static | "Date", "Time", "Contract", "Entry" (right-aligned), "Peak" (right-aligned), "Peak P/L" (right-aligned) | none | present whenever the table renders |
| Row — Date cell | API field `date` | raw string as returned (no reformat) | class `mono dim` | n/a |
| Row — Time cell | API fields `checkpoint_label` (fallback `checkpoint`) | text as returned | class `mono ck` | falls back to raw `checkpoint` code if no label |
| Row — Contract chip | API fields `strike`, `side` via `contractLabel()` | `{strike.toFixed(0)}{side}` e.g. "7750C"; or "—" if no strike | chip border/text `var(--cyan)`; class `off` (dim border/text `var(--line2)`/`var(--dim2)`) when `status==="skipped"` | `title` = `skip_reason ?? "not taken"` when skipped, else `{ticker} {expiration}{· CB {cb_strike}}` |
| Row — CB-walked indicator | API fields `cb_strike`, `strike` | inline "←CB {cb_strike.toFixed(0)}" | shown only when `cb_strike != null` AND `cb_strike !== strike` (i.e. the recorder walked to a different strike than the CB target) | omitted when CB strike equals the traded strike or is null |
| Row — Entry cell (filled) | API fields `entry_price`, `entry_ts`, `entry_spot` | `${entry_price.toFixed(2)}`; `title`="filled {etClock(entry_ts)} · SPX {entry_spot.toFixed(2)}" | plain text colour | n/a |
| Row — Entry cell (not filled) | API fields `probe_price`, `skip_reason` | if `probe_price != null`: "($probe_price.toFixed(2))"; else "—" | class `dim2`; `title` = `skip_reason ?? "not taken"` | shown whenever `entry_price == null` |
| Row — Peak cell (has value) | API fields `best_price`, `best_ts`, `worst_price` | `${best_price.toFixed(2)}` + inline time chip `{etClock(best_ts)}` if `best_ts` present | class `up` if `entryVsPeak > 0` else `dim`; `title`="peak ${best_price} at {time} · low ${worst_price}" | n/a |
| Row — Peak cell (no value) | API field `best_price == null` | "—" | class `dim2` | n/a |
| Row — Peak P/L cell | client derivation `entryVsPeak = round((best_price − entry_price) × 100) / 100`; requires both non-null — **entry → peak, explicitly NOT the held-to-close `pnl` field** | `{sign}{shown.toFixed(2)}{"*" if open}` + inline USD span `{sign}$${abs(shown*mult).toFixed(0)}` | class `pl` + (`flat` if `shown==null`; `up` if `shown>=0`; `down` if `shown<0`) + `live` (opacity 0.75) when `status==="open"` | "—" when `best_price` or `entry_price` is null |
| Row overall styling — skipped | API field `status === "skipped"` | row opacity 0.55 (class `skip`) | n/a | row still renders (skipped rows are never dropped) |
| Footer — totals line | client counts over `trades`: `taken` = count `status !== "skipped"`; `open` = count `status === "open"` | "{taken} traded · {open} open" | none | shown whenever the table renders (i.e. `trades.length > 0`) |
| Footer — legend line | static text | "←CB marks a walked strike · P/L is entry → peak, per contract · **\*** still open" | none | as above |
| Multiplier | API field `config.MULTIPLIER` (`mult` state, default 100 if response field is not a finite number) | used to scale Peak-P/L into the USD span (`shown * mult`); never displayed as a standalone value on the card | none | defaults silently to 100 if `config.MULTIPLIER` missing/non-numeric |
| Loading state (whole card body) | client state `state === "loading"` | "Loading contracts…" replaces the table | n/a | shown before first response |
| Empty state (no trades yet) | `state==="ok" && trades.length===0` | "No checkpoints recorded yet. The first row of a session prints at 9:45 ET — this table fills itself in as they do." | n/a | replaces the table |
| **Card removes itself — denied** | HTTP 401/403 from `/api/cb-contracts` | entire component returns `null` (no card, no message) | triggered on `r.status===401 \|\| 403` | nothing renders at all |
| **Card removes itself — error** | any other non-OK HTTP status, or a thrown/caught fetch exception | entire component returns `null` — **same as the denied case; a network/API failure is visually indistinguishable from "not a subscriber"** | `state==="error"` | nothing renders at all |

#### C.2 — Detail popup (`CbProbeCard`, opened by clicking a contract chip)

| Label as shown | Source (hook/API field or derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Modal header — symbol | API fields `ticker`, `strike`, `side` via `contractLabel()` | "{ticker} {strike}{side}" | class `cy` (cyan) | n/a |
| Modal header — sub line | API fields `expiration`, `checkpoint_label`/`checkpoint` | "{expiration} · {checkpoint_label or checkpoint}" | none | n/a |
| Close button "×" | static | `title`="Close (Esc)"; also closes on Escape key | none | n/a |
| Headline — peak % move | client: `peakPct = ((best_price − entry_price) / entry_price) × 100`, requires `entry_price != 0` | "▲/▼ {abs(peakPct).toFixed(1)}%" | ▲ + `up` colour if `peakPct >= 0`; ▼ + `down` if negative | "—" when `entry_price` or `best_price` is null |
| Headline sub-line — entry→now/sold | API fields `entry_price`, `exit_price` (fallback `last_price`) | "in ${entry} → {sold\|now} ${mark}" | label is "sold" if `exit_price != null` else "now" | `px()` renders "—" for a null price |
| Headline sub-line — % delta | client: `pct = ((effMark − entry) / entry) × 100` | " · {sign}{abs(pct).toFixed(1)}%" | coloured via `cls()`: up/down/flat | omitted (empty string) when `pct` null |
| Headline sub-line — $ delta | client: `dollars = (effMark − entry) × mult` | " · {sign}$${abs(dollars).toFixed(0)}/ct" | coloured via `cls()` | omitted when `dollars` null |
| Stat tile "CB" | API fields `cb_strike`, `cb_price` | "{cb_strike.toFixed(0)}{ @ $cb_price.toFixed(2)}" or "—" | tone `cy` (cyan) always | "—" when `cb_strike` null |
| Stat tile "Entry" | API fields `entry_price`, `entry_ts` | "$entry.toFixed(2) · {etClock(entry_ts)}" or "not taken" | tone `flat` (dim) when `entry_price` null, else default | "not taken" when no entry |
| Stat tile "Peak" | API fields `best_price`, `best_ts` | "$best_price.toFixed(2) · {etClock(best_ts)}" or "—" | tone `up` when present, else `flat` | "—" when null |
| Stat tile "Low" | API fields `worst_price`, `worst_ts` | "$worst_price.toFixed(2) · {etClock(worst_ts)}" or "—" | no tone override (default text colour) | "—" when null |
| Stat tile "Close" | API field `exit_price`, else `status` | "$exit_price.toFixed(2)"; or "open" if `status==="open"`; else "—" | tone `am` (amber) when exited, else `cy` (cyan) | "—" for a skipped/never-opened row |
| Stat tile "P/L" | client: `pnl = trade.pnl` field, fallback `round((last_price − entry_price)×100)/100` — **this is the held-to-close/mark P/L, distinct from the row table's entry→peak figure** | "{sign}{pnl.toFixed(2)}" or "—" | tone via `cls()`: up/down/flat | "—" when both `pnl` and the fallback are unavailable |
| Metric toggle "Price" | static (key `mark`) | button label "Price"; chart values `${v.toFixed(2)}` | active (`on` class, cyan) when `metric==="mark"` | hidden entirely when `status==="skipped"` |
| Metric toggle "SPX" | static (key `spot`) | button label "SPX"; chart values `v.toFixed(2)}` (no prefix) | active state as above | hidden when skipped |
| Metric toggle "Dist" | static (key `dist`) | button label "Dist"; chart values `v.toFixed(1)}` (no prefix) | active state as above | hidden when skipped |
| Last-poll warning banner | API field `last_error` | "Last poll unpriced — {last_error}" | amber banner (`var(--amber)` text, amber border/wash) | shown only when `last_error` truthy |
| Ticks-fetch error message | client: fetch to `/api/cb-contracts?ticks={id}` throws | "History failed to load: {err}" | class `bad` (`var(--neg)`) | shown only on fetch failure, takes precedence over the chart/skip states below it |
| Skipped-trade block — heading | API field `status==="skipped"` | "Not taken" | amber, bold | replaces the chart entirely — no empty chart frame is drawn |
| Skipped-trade block — reason | API field `skip_reason` | raw text, or "—" if null | mono | n/a |
| Skipped-trade block — probe line | API fields `probe_ts`, `cb_price`, `cb_strike` | "Probed {etClock(probe_ts)}{ · CB {cb_strike.toFixed(0)} @ $cb_price.toFixed(2)}" | mono, dim | CB clause omitted when `cb_price` null |
| "Loading history…" | client: `ticks === null` (fetch in flight) | plain text | n/a | shown while the ticks request is outstanding |
| Footer hint — metric description | client: `metric` state | "Option price (mark)" / "SPX spot" / "SPX distance to CB" | none | n/a |
| Footer hint — RTH note | static | " · RTH only" | none | always appended |
| Footer hint — entry clause | API field `entry_price` | " · entry @ $entry.toFixed(2)" | shown only if `entry != null` | omitted otherwise |
| Footer hint — sold clause | API field `exit_price` | " · sold @ $exitV.toFixed(2)" | shown only if `exit_price != null` | omitted otherwise |

#### C.3 — Probe chart (`CbProbeChart`, inside the popup)

**Sort order:** ticks plotted in the order returned by `/api/cb-contracts?ticks={id}` (chronological, per-minute poll series); x-domain is `[min(ts), max(ts)]` of the plotted points.

| Label as shown | Source (hook/API field or derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Y-axis gridlines + labels | client: 5 ticks at fractions [0, .25, .5, .75, 1] of the value domain (`mark`/`spot`/`dist` per selected metric, from `/api/cb-contracts?ticks=`) | `{prefix}{v.toFixed(dec)}` per `CB_METRICS` spec (Price: "$", 2dp; SPX: "", 2dp; Dist: "", 1dp) | none | axis not drawn if fewer than 2 valid points (see below) |
| Entry reference line | API field `entry_price` (prop `entry`) | dashed horizontal line + label "entry ${entry.toFixed(2)}" | drawn only when `metric === "mark"` and `entry != null`; domain is padded to include it so it is never off-canvas | omitted for the "SPX"/"Dist" metric views |
| Price/metric line + area fill | API field per selected metric (`mark`/`spot`/`dist`) across all ticks | cyan line (1.75px) over a cyan-to-transparent gradient area | none | n/a |
| Peak marker (vertical line + dot) | prop `peak` = `{ v: best_price, ts: best_ts }`, matched to nearest tick by timestamp | dashed vertical line (`var(--posEdgeUp)`) + filled circle (`var(--pos)`) at that tick | drawn only when `peak` is non-null (i.e. `best_price` and `best_ts` both present) | omitted when no peak to mark |
| Latest-point marker | last plotted tick | small solid cyan circle | none | n/a |
| X-axis time labels | tick timestamps, min and max | `HH:mm` 24-hour, America/New_York | none | n/a |
| Empty/insufficient-data message | client: fewer than 2 valid `{ts,v}` points after filtering nulls | 0 points: "No polls recorded yet. The recorder writes one tick a minute while a position is open."; exactly 1 point: "Only one poll recorded — not enough for a line." | n/a | replaces the entire chart (no axes drawn) |

---

# Part 4 — Post-Market tab and Historical Recap

Sources read in full:
- `components/pages/premarket/PostMarketTab.tsx` (2234 lines)
- `components/pages/premarket/postMarketData.ts` (1381 lines)
- `components/pages/premarket/HistoricalRecap.tsx` (597 lines)

Shared formatters referenced below by name (defined per-file, values differ — noted where they diverge):

- **PostMarketTab `fmtPx(v,dp=0)`**: `—` if `v==null`/non-finite/`v<=0`, else `nf(v,dp)` (locale-grouped, fixed `dp` decimals).
- **PostMarketTab `fmtPts(v)`**: `—` if null/non-finite, else `±` (`+`/`−`) + `nf(|v|,0)` + `" pts"`.
- **PostMarketTab `fmtPct(v,dp=2)`**: `—` if null/non-finite, else `±` + `|v|.toFixed(dp)` + `%`.
- **PostMarketTab `fmtUsd(v,signed=true)`**: `—` if null/non-finite; else sign is `−` if negative, `+` if `signed` and positive, else none; magnitude ≥1e9 → `$X.XXB`; ≥1e6 → `$X M` (0dp); ≥1e3 → `$X.XK` (1dp); else `$X` (0dp).
- **HistoricalRecap `fmtPx(v,dp=0)`**: same null/NaN guard as above but does **not** exclude `v<=0` (a settled 0 or negative level would still print, unlike PostMarketTab's version).
- **HistoricalRecap `fmtPts(v)`**: takes a definite number (no null guard) — `±` + `nf(|v|,0)`, **no `"pts"` suffix** (differs from PostMarketTab's).
- **HistoricalRecap `fmtUsd(v)`**: `—` if null/NaN; **never shows a `+`**, only `−` for negatives; ≥1e9 → `$X.XXB`; ≥1e6 → `$X.XM` (1dp, differs from PostMarketTab's 0dp); ≥1e3 → `$XK` (0dp); else `$X`.
- **`nf(v,dp)`**: `v.toLocaleString("en-US",{minimumFractionDigits:dp,maximumFractionDigits:dp})`.
- **`kDp`**: strike decimal places, derived from the smallest gap in `perStrike` (0 if step≥1, 1 if 0.5≤step<1, 2 if step<0.5; falls back to `spot>=1000?0:2`). SPX evaluates to 0.
- **`pxDp`**: traded-price decimals — `0` if `spot>=1000`, else `2`.
- **`REACTION_LABEL`** (`postMarketData.ts`): `reject→REJECTED, break_lt5→"BROKE <5", break_5→BROKEN, consolidated→"BROKE & HELD", new_wall→"WALL ROLLED", pin→PINNED, rolled_over→"HELD AT DISTANCE", reached→TAGGED, stalled→"STALLED NEAR"`.
- **`REACTION_TONE`**: `reject→ok, rolled_over→ok, break_lt5→warn, break_5→bad, consolidated→bad, new_wall→bad, pin→vio, reached→warn, stalled→warn`. Tone→pill class: `ok→"pill cool"`, `bad→"pill hot"`, `warn→"pill warn"`, `vio→` inline violet style (border/color/background), none→`"pill"`.
- **`LEVEL_LABEL`**: `call_wall→"Call Wall", put_wall→"Put Wall", cb→"CORE"`.

---

### SYMBOL ROUTING — what's SPX-only

- **PostMarketTab.tsx itself is symbol-agnostic.** Since 2026-08-27 every hook it calls directly — `useIntradayLadder(true, expiry, etDate, sym)`, `useNextExpiryStructure(!frozen, expiry, spot, sym)`, `useRecordedWalls(etDate, sym, etMin)` — takes the `sym` prop and reads that ticker's own server rows. All of Sections 1–6 render for any MAIN-watchlist symbol.
- What differs upstream (outside this file, in `postMarketData.ts` / the parent page) is **how the props themselves are populated**: SPX rides the live socket (`useMobileGex`/`lib/gexSocket`, which is single-symbol); every other MAIN ticker gets `useTickerBoard(ticker)` — a 60-second poll of `/api/expirations` → `/api/chains`, gamma computed client-side with the `optionChain.parseExpiration` convention (`γ·(OI+Vol)·S²·0.01·100`). A non-socket ticker is therefore always up to 60s stale and has no `esFut`/`basis` (this tab never uses those anyway — see file header "NOTHING ON THIS TAB IS A FUTURE").
- **HistoricalRecap.tsx is NOT symbol-agnostic.** Only Section 3 (wall log) actually reads the picked `symbol`. Sections 1, 2, 4, 5 are pinned to SPX regardless of what is selected:
  - Section 1 (`useGexLevelsHistory`, `useEodGex`) — both hardcoded to SPX-keyed stores; `spxOnly` banner shown whenever `symbol !== "SPX"`.
  - Section 2 (`useSessionEsBars`) — ES futures bars, symbol-independent by construction (there is only one ES series).
  - Section 4 (`useIntradayLadder(true, date, date)`) — called with **only 3 args**, so its `symbol` parameter is omitted and defaults to `"SPX"` inside the hook; the per-minute ladder shown here is always SPX's, even when a different ticker is selected on the picker.
  - Section 3 (`useRecordedWalls(date, symbol)`) — the one section that honestly reflects the picked symbol.
  - Section 5 (journal) — symbol-independent (notes are keyed by date only, in `NOTES_KEY`, shared with the live tab).

---

## PART A — POST-MARKET TAB (`PostMarketTab.tsx`)

### Section 1 — Day Snapshot

Order on page: KPI tile → range bar → Net GEX tile → verdict/bias card.

| Label as shown | Source (hook/API or derivation) | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Section right-label | `path.pts.length` (from `cols`, i.e. `useIntradayLadder`) + `expiry` prop | text: `"per-minute {sym} recorder"` or `"no recorded path"` · `{expiry \|\| "—"}` | none | `"no recorded path"` when `path.pts.length===0` |
| `{sym} Close` | `closePx` = `spot>0 ? spot : path.pts[last].px` | `fmtPx(closePx, pxDp)` | none | `—` when `closePx<=0` |
| Close sub-line (day change) | `dayChg = pdcSpx!=null && closePx>0 ? closePx-pdcSpx : null`; `pdcSpx = prevClose` prop | `fmtPts(dayChg)` + `" / "` + `fmtPct((dayChg/pdcSpx)*100)` | class `chg-pos` if `dayChg>=0` else `chg-neg`; class omitted (undefined) when `dayChg==null` | text `"vs prior close —"` when `dayChg==null` |
| H/L/range sub-line | `rthHi`/`rthLo` = max/min of `path.pts[].px` | `"H {fmtPx(rthHi,pxDp)} · L {fmtPx(rthLo,pxDp)} · {nf(rthHi-rthLo,pxDp)} pt range"` | none | trailing clause is `"—"` when either `rthHi` or `rthLo` is null |
| "Day range vs the morning wall band" caption | static label | text | none | always shown |
| Wall-band track (gradient bar) | static visual: CSS gradient neg→transparent→pos | fixed-position bar, no bound value | none (decorative range backdrop) | always rendered |
| Actual-range bar (`.act`) | `rPos(rthLo)` / `rPos(rthHi)`, where `rPos(px)=((px-domain.lo)/(domain.hi-domain.lo))*100` clamped 0–100; domain from `[callWall,putWall,rthHi,rthLo,closePx]` padded ±10% | `left`/`width` in % | not drawn (no `.act` div) when `rPos(rthLo)` or `rPos(rthHi)` is null | absent when `rangeDomain` is null (needs ≥2 of the 5 inputs) |
| Put-wall marker + caption | `putWall` prop, `rPos(putWall)` | tick at `left:{rPos}%`, color `var(--pw)`; caption `"PW {fmtPx(putWall,kDp)}"` clamped to `left ≥ 9%` | color fixed pw-red | tick/caption both absent when `putWall==null` or `rPos` null |
| Call-wall marker + caption | `callWall` prop, `rPos(callWall)` | tick + `"CW {fmtPx(callWall,kDp)}"` clamped to `left ≤ 91%` | color fixed cw-green | absent when `callWall==null` |
| Close marker + caption | `closePx`, `rPos(closePx)` | white tick + `"close {fmtPx(closePx,pxDp)}"` clamped `28–82%` | white, no threshold | absent when `rPos(closePx)` null |
| Range-bar footer labels | `rthLo`, `todayWidth = \|callWall-putWall\|`, `rthHi` | `"L {fmtPx(rthLo,pxDp)}"` · `"{nf(todayWidth,pxDp)} pt wall band"` · `"H {fmtPx(rthHi,pxDp)}"` | none | middle label is empty string when `todayWidth==null` |
| "Net GEX · open → now" value | `openNetGex = Σnet` of first recorded column's cells; `totalNetGex` prop | `openNetGex==null` → `fmtUsd(totalNetGex)`; else `"{fmtUsd(openNetGex)} → {fmtUsd(totalNetGex)}"` | none | shows only `fmtUsd(totalNetGex)` when no open snapshot |
| Net GEX regime pill | `openNetGex`, `totalNetGex` sign comparison | text: `"positive gamma"`/`"negative gamma"` (no open snapshot) · `"regime held positive/negative"` (same sign both ends) · `"REGIME FLIPPED"` (sign differs) | pill class `cool` if `(totalNetGex??0)>=0` else `hot` | — |
| Net GEX tiny sub-line | `netGexChg = totalNetGex-openNetGex`; `openFlip` (via `findGEXFlip` on the open column), `flip` prop | `"{fmtUsd(netGexChg)} on the day"` + optional `" · flip {fmtPx(openFlip,kDp)} → {fmtPx(flip,kDp)}"` | none | `"no open snapshot"` when `netGexChg==null`; flip clause omitted unless both `openFlip` and `flip` are non-null |
| Verdict/bias card title | `verdict.t`, computed from `hasData`, `closePx`, `rthHi/Lo`, `callWall`, `putWall`, `coreBullseye` | one of: `WAITING FOR DATA` / `BOTH WALLS GAVE` / `BROKE THE CALL WALL` / `BROKE THE PUT WALL` / `PINNED` / `HELD THE RANGE` / `NO WALLS TO GRADE` | card gets class `neg` (red-tinted) when `verdict.neg` is true (both-walls-gave / broke-call / broke-put); no tint otherwise | `WAITING FOR DATA` when `!hasData \|\| closePx<=0 \|\| rthHi==null \|\| rthLo==null` |
| Verdict/bias card detail | `verdict.d` | full sentence built from `fmtPx`/`fmtPts` of the triggering levels | tied to the same branch as the title | `"no chain or no session bars yet."` under WAITING FOR DATA |

**Verdict thresholds** (in evaluation order): `brokeCall = callWall!=null && rthHi>callWall`; `brokePut = putWall!=null && rthLo<putWall`; `pinned = coreBullseye!=null && |closePx-coreBullseye.strike| <= max(5, spot*0.0008)`; `inside = !brokeCall && !brokePut && callWall!=null && putWall!=null`. First true branch wins, in the order both-broke → call-broke → put-broke → pinned → inside → else "no walls to grade".

---

### Section 2 — Level Performance Scorecard

Order: 5 fixed cards in array order `CW, PW, FLIP, CORE, MP` → move log (chronological) → empty-state warnbar.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Section right-label | `wallState` (from `useRecordedWalls`), `path.pts.length` | `"{sym} wall log · 09:29 → 16:00"` / `"loading the wall log…"` / `"wall log unavailable"` + optional `" · {n} price samples"` | none | `"wall log unavailable"` on `error`; `"loading…"` on `loading` |
| **Call Wall** card name+pill | `grades[0]` = `withRecorded(build("CW","Call Wall","resistance",callWall,cw-color,"above"),"call_wall")` | name text `"Call Wall"` colored `var(--cw)`; pill = `g.status` | pill class `cool`/`hot`/`warn` from `g.tone` (`ok/bad/warn`), or inline violet style if `vio` | pill text `"—"` and tone `""` when `callWall==null` |
| Call Wall price | `g.px` = recorder's `rec.last` if recorded, else the `callWall` prop | `fmtPx(g.px, kDp)` | none | `—` when no level |
| Call Wall detail sub-line | recorded: `"{open}→{last}"` or `"held {last} all day"` + `"moved N×"`/`"never moved"` + `"N tags"`/`"no tags"`, joined by `" · "`; derived fallback (no recorder data): `"{beyond min} beyond · first break HH:MM"` (broken) / `"tagged N× · first HH:MM · last HH:MM"` (held) / `"never within {tol} pts"` (untested) | text, `nf`-formatted numbers | — | `"no intraday prices recorded"` when `path.pts` empty; `"no level"` when `callWall==null` |
| Call Wall taps timeline | `g.taps` — 12-bucket array over the session, each bucket flagged from the price path vs `tol = max(0.01, spot*0.0005)` | 12 small bars | bucket empty (height 5, sunken) / `t` touch (green, h13) / `b` beyond (red, h16, overrides `t`) / `c` cross (amber, h10) — n/a for CW (mode "above" never sets `c`) | all-empty bars when no level/path |
| Call Wall foot sub-line | recorded: excursion/reclaim/attempts joined, else `"recorded by the wall log"`/`"watched all day, never traded into"`; derived: `"resistance failed"` / `"defended"` / `"never reached"` | text | — | empty string `""` on the base no-level case |
| Call Wall source caption | `g.src` | `"graded by the wall log"` (recorded) or `"derived · resistance"` (derived) | — | — |
| **Put Wall** card (name/pill/price/detail/taps/foot/src) | same shape as Call Wall, `build(...,"below")` + `withRecorded(...,"put_wall")`, hint `"support"` | mirrors CW row-set | mode `"below"`: broke = `rthLo<putWall` analog inside `build`; foot `"support failed"`/`"defended"`/`"never needed"` | same empty-state rules as CW |
| **Gamma Flip** card (name/pill/price/detail/taps/foot/src) | `build("FLIP","Gamma Flip","regime",flip,amber,"cross")` — **never** wrapped in `withRecorded` (flip is not recorder-tracked) | status `"CROSSED N×"` / `"NEVER CROSSED"`; detail `"{beyond min} on the far side · first HH:MM"` / `"held one side of the flip all session"`; foot `"regime changed hands intraday"`/`"one regime, all day"` | tone `warn` if crossed, else `ok` | src is always `"derived · regime"` (recorded branch never applies) |
| **CORE** card (name/pill/price/detail/taps/foot/src) | `build("CORE","CORE","max γ",coreBullseye?.strike,violet,"near")` + `withRecorded(...,"cb")` | status `PINNED` / `NEAR` / `MISSED` / `—`; detail `"{mins within tol pts / 'never reached'} · close {fmtPts(dist)}"` | tone `vio` if `pinned = |closePx-px| <= max(5, spot*0.0008)`, else none | `—` when `coreBullseye==null` |
| **Max Pain** card (name/pill/price/detail/taps/foot/src) | `build("MP","Max Pain","OI",maxPain,blue,"near")` — never `withRecorded` | same "near" shape as CORE | same pinned rule against `maxPain` | src always `"derived · OI"` |
| Move-log header | `wallLog` filtered `reason==="change"` | `"Every time a level moved today · {n} {move/moves}"` | — | section (whole block) hidden unless `wallState==="ok" && wallLog.some(reason==="change")` |
| Move-log row | one row per moved level | time `at.slice(0,5)` or `"slot {n}"` (mono) · level label colored (cw/pw/violet) · `"{prev→}new"` mono + colored `fmtPts(delta)` (`chg-pos`/`chg-neg`) · `"spot {fmtPx(spot,pxDp)}"` | `delta>=0`→green, else red | delta span omitted entirely when `r.delta==null` |
| **Sort order** | move-log rows sorted by `slot` ascending (chronological, 09:29→16:00) | | | |
| Wall-log-empty warnbar | `wallState==="empty"` | `"Nothing recorded in the {sym} wall log for {etDate} — the three wall cards above are graded from the price path instead of the recorder's own verdict."` | — | shown only in this state |

---

### Section 3 — How the Book Was Built

Two-column body: left = per-strike evolution ladder; right = Wall migration chart + Written vs Traded rows.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Legend chips (per active bucket) | `activeBuckets` — filtered from `BUCKET_DEFS` (`AM 09:30–12:00` blue, `MID 12:00–15:00` violet, `PM 15:00–close` amber) to only buckets the ladder covers ≥5 real minutes of | swatch + `"{etMinOfDay(from)}–{until>=RTH_CLOSE_MIN?'close':etMinOfDay(until)}"` | swatch colors fixed: blue/violet/amber | a bucket the ladder doesn't cover is simply dropped from the legend (not shown as empty) |
| Power-hour legend chip + tooltip | `hasPm = evRows.some(pmShare!=null)` | swatch (split neg/amber gradient) + text `"15:00→close · board share · own scale"`; `title=` tooltip explains the share-vs-dollar methodology | — | chip entirely absent when no row has a `pmShare` |
| histNote warnbar | `histState` (`useIntradayLadder`), `beforeLadder = histState==="ok" && !cols.length && allCols.length>0` | 4 possible texts (see below) | — | see rows below |
| — beforeLadder text | | `"Nothing recorded yet at {etClockOf(etMin)} ET — the per-minute ladder starts at the 09:30 open. Scrub forward and the build bars fill in from there."` | — | shown when replay scrubber is set before the session started |
| — loading text | `histState==="loading"` | `"Loading today's recorded ladder…"` | — | |
| — empty text | `histState==="empty"` | `"No per-minute ladder recorded for today — the build-time bars, the wall path and the written-vs-traded read all need it. Everything else below is live."` | — | |
| — error text | `histState==="error"` | `"The intraday recorder did not answer, so section 3 and the wall path have nothing to read. Everything above and below them is live."` | — | |
| Missing-buckets warnbar | `missingBuckets` (buckets NOT in `activeBuckets`) — only shown when `!histNote` | `"The per-minute ladder for {etDate} only holds {from}–{to}, so the {bucket name(s)} bucket(s) {is/are} not drawn — those bars would be an unrecorded window painted as 'no activity'. Everything shown is inside the recorded window."` | — | absent when `missingBuckets.length===0` or `histNote` is already showing |
| Evolution ladder empty state | `evRows.length===0` | `"Waiting for the chain…"` centered | — | — |
| Evolution row — strike | `evBars` (±60 strikes around spot from `perStrike`) | `nf(strike, kDp)` mono | — | — |
| Evolution row — sign chip | `r.net >= 0` | `+`/`−` glyph | `p` class green if positive, `n` class red if negative | — |
| Evolution row — signed $ column | `r.net` (this strike's closing net GEX, over the recorded window) | `fmtUsd(r.net, false)` (unsigned formatting — no `+`/`−` prefix, color carries the sign) mono | text color `var(--pos)`/`var(--neg)` by sign | — |
| Evolution row — bar track (build-time segments) | `r.segs` = per-bucket share-of-board moves, normalised over `Σ|Δshare|` per bucket so segments always fill the bar | segment `width = share * w%` where `w = min(100, |net|/maxAbsBar*100)`; `maxAbsBar = max(1, max(|net|) over ALL rendered rows)` | segment color = bucket color (blue/violet/amber), opacity 0.95 pos / 0.82 neg; falls back to one solid `bar.p`/`bar.n` if no segments computed | — |
| Evolution row — power-hour column (15:00→close) | `r.pmShare` = `closeShare - shareAt(pmAnchor)`, in percentage points of board share | half-track bar, `width = min(50, |pmShare|/maxPmAbs*50)%`, `maxPmAbs = max(0.05, max(|pmShare|) over rows)`; zero line drawn only when a reading exists | grows **right/amber** (`up`) when `pmShare>=0` (took share), **left/red** (`dn`) when negative (lost share); bar suppressed (only zero line, no `i`) when `|pmShare| < 0.02` (flat) | column entirely unpainted (`class="pmtrack off"`, no zero line) when `r.pmShare==null` (power hour never reached in the replay/recording) |
| Evolution row — built-column text | `r.dominant` (biggest bucket share) + `pmTxt` | `"{round(dominant.share*100)}% {LABEL}"` colored by bucket, then `" · {±}{|pmShare|.toFixed(1)}pp"` colored amber/red/dim2(flat) | suppressed (`meaningful=false`) when `|net| < maxAbsBar*0.02`; `pmTxt` null when `pmShare==null` or not meaningful; shows `"flat pm"` in dim2 when `|pmShare|<0.02` | dominant clause omitted when `!meaningful`; pp clause omitted when `pmTxt==null` |
| Evolution row — tag column | `openTag(strike)` — matches strike against `callWall`/`putWall`/`coreBullseye.strike`/`maxPain` | text `CALL WALL`/`PUT WALL`/`CORE`/`MAX PAIN`, colored cw/pw/violet/blue | row also gets CSS class `key` (bold strike) when tagged | text is empty string, color `transparent`, when no tag matches |
| Evolution row — tooltip (`title=`) | derived per row | 3-line tooltip: `"{strike} · {fmtUsd(net,false)} at the close"`, `"{closeShare.toFixed(1)}% of the board's gamma at the close"`, and either the pm-share sentence or `"15:00→close not recorded"` | — | pm-share line reads `"15:00→close not recorded"` when `pmShare` or `pmBase` is null |
| "⤒ back to close" button | `evPinned` state (scroll tracking) | button, re-centers ladder on `closePx` | — | button hidden while the ladder is auto-pinned (`evPinned===true`) or when `evRows.length===0` |
| **Sort order** | `evRows` built from `evWindow(60)` = `perStrike` window around spot, `.slice().reverse()` — so rows render **strike descending** (highest strike at top) when `perStrike` itself is ascending | | | |
| Wall-migration header | `cols.length` | `"Wall migration"` + tiny `"net-basis proxy · {n} min"` | — | — |
| Wall-migration legend | static | `CORE — the heavier wall` (violet swatch) · `the other wall` (translucent white) · `spot` (white) | — | — |
| Wall-migration chart (`WallChart` SVG) | `wallPath` — per-minute mode-smoothed (5-sample window) net-basis call/put picks, relabeled into two ROLES: `core` = heavier-gamma wall that minute, `other` = the lighter one; `spot` = per-minute price | inline SVG, 3 series: shaded corridor between core/other (blue wash fill), `other` polyline (white 42%, step-interpolated), `core` polyline (violet, step-interpolated), `spot` polyline (white, smooth/continuous) — no axis labels on the SVG itself | roles swap (line identities swap) whenever the heavier-gamma side changes; drawn as discrete steps (not diagonals) because a wall holds one strike then jumps | absent — replaced by `"Needs the recorded ladder."` (tiny text) — when `cols.length<3` or fewer than 3 valid (cw,pw) pairs |
| Wall-migration x-axis labels | `wallPath.pts` first/middle/last timestamps | 3 × `etHm(ts)` | — | — |
| Wall-migration caption | `wallPath.callCoreShare` = fraction of minutes the call side was the heavier (CORE) wall | `"CORE is whichever wall carries more gamma at that minute… today the call wall held it {round(callCoreShare*100)}% of the session. …"` | bolded percentage | — |
| Written-vs-traded header | — | `"Written vs traded"` + tiny `"gamma added ↔ time at price"` | — | — |
| Written-vs-traded row — left bar (gamma added) | `writtenVsTraded[i].added = |lastVal - firstVal|` per strike (from `series`) | bar `width = (added/maxA)*100%`, violet→transparent gradient, grows leftward (right-anchored) | — | replaced by `"Needs the recorded ladder."` when `writtenVsTraded.length===0` |
| Written-vs-traded row — strike label | `evNear` strikes (±12 window) | `nf(strike, kDp)` mono, centered | — | — |
| Written-vs-traded row — right bar (minutes at price) | `writtenVsTraded[i].minutes` = count of recorded minutes spot was within one strike-step of this strike | bar `width = (minutes/maxM)*100%`, blue gradient, grows rightward | — | — |
| Written-vs-traded footer labels | static | `"← gamma written"` / `"minutes at price →"` | — | — |
| **Sort order** | `writtenVsTraded` follows `evNear` = `evWindow(12)` reversed → strike **descending** | | | |

---

### Section 4 — Positioning at the Close

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Section right-label | static | `"same chain, same formulas as the GEX chart"` | — | — |
| Net DEX tile | `totals.dex` prop | `fmtUsd(totals.dex)` | sub-label `"dealers long delta"` if `dex>=0` else `"dealers short delta"` | `fmtUsd` → `—` if not finite (dex is typed non-null though) |
| Net Vanna tile | `totals.vanna` prop (nullable — no per-contract vanna on some feeds) | `fmtUsd(totals.vanna)` | sub-label: `"vol down helps the tape"` if `vanna>=0`, `"vol down pressures the tape"` if `<0` | `"no per-contract vanna on this feed"` when `vanna==null` |
| Net GEX on the day tile | `netGexChg` (from Section 1's open-vs-now calc) | `netGexChg==null ? "—" : fmtUsd(netGexChg)` | sub-label `"gamma built through the session"` (`>=0`) / `"gamma bled out of the book"` (`<0`) | sub-label `"no 09:30 ladder"` when `netGexChg==null` |
| Call vs Put gamma tile — headline | `totals.callGex`, `totals.putGex` | `"{round(c/(c+pu)*100)}% / {round(pu/(c+pu)*100)}%"` | — | `—` when `c+pu<=0` |
| Call vs Put gamma tile — sub-line | same | `"{fmtUsd(callGex,false)} calls · {fmtUsd(putGex,false)} puts"` (unsigned) | — | — |
| Call vs Put gamma split bar | same | two segments, `width` proportional to each side's share | call segment green gradient, put segment red gradient | bar renders nothing (`null`) when `c+pu<=0` |
| Positioned-vs-written header | `oiSplit` (from live `chain`, per-side OI+volume-weighted gamma) | `"Positioned vs written"` + tiny `"top strikes by gamma"` | — | whole sub-section (both columns) hidden entirely when `oiSplit.length===0` |
| Positioned-vs-written legend | static | `"settled OI"` (blue swatch) · `"today's volume"` (amber swatch) | — | — |
| Positioned-vs-written row — strike | `oiSplit[i].strike` | `nf(strike, kDp)` mono | — | — |
| Positioned-vs-written row — stacked bar | `oiSplit[i].oiShare` = `oiPart/(oiPart+volPart)` per strike; overall bar width scaled to `|net|/maxN2` | stacked bar: blue segment = `oiShare`, amber segment = `1-oiShare` | — | — |
| Positioned-vs-written row — value | `oiSplit[i].net` = `netGEXOf(row,"net",spot)`, `oiSplit[i].oiShare` | `"{fmtUsd(net,false)} {round(oiShare*100)}% OI"` — pct colored blue, `"OI"` label dim2 | — | — |
| "What that means" column | static explanatory text (no bound values) | prose | — | — |
| **Sort order** | `oiSplit` = top 9 strikes by `|net|` descending, then **re-sorted by strike descending** for display | | | |

---

### Section 5 — Tomorrow's Map

Suppressed entirely on a frozen session (see row 1).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Frozen-session variant | `frozen = !!frozenDate` | header `"Tomorrow's Map"` + right label `"not available for a past session"` + warnbar explaining the next-expiry chain would be TODAY's, not the frozen day's | — | this entire variant IS the empty state for a frozen session — no live rail is rendered |
| Section right-label (live) | `nextState` (`useNextExpiryStructure`) | `"{next.expiry} chain"` (ok) / `"loading the next expiry…"` / `"next expiry unavailable"` | — | — |
| Loading/unavailable warnbar | `nextState!=="ok" \|\| !railMarks` | `"Pulling the next expiry's chain…"` (loading) or `"Could not build tomorrow's structure — the next expiry's chain did not answer. Today's numbers above are unaffected."` | — | this row replaces the whole rail+tiles+bias block |
| Rail marker — Put Wall | `next.putWall` | tick colored `var(--pw)`, code `PW`, name `"Put Wall"`, price `fmtPx(next.putWall,kDp)`, `fmtPts(dist)` from close | — | marker omitted (not pushed to `marks[]`) when `next.putWall==null` |
| Rail marker — Gamma Flip | `next.flip` | code `FLIP`, `"Gamma Flip"`, same price/dist format, amber | — | omitted when `next.flip==null` |
| Rail marker — CORE | `next.cb` | code `CORE`, `"max γ strike"`, violet | — | omitted when `next.cb==null` |
| Rail marker — Close | `closePx` | code `CLOSE`, `"{sym} Close"`, white; `d2` reads `"settled"` instead of a distance | — | omitted when `closePx<=0` |
| Rail marker — Call Wall | `next.callWall` | code `CW`, `"Call Wall"`, green | — | omitted when `next.callWall==null` |
| Rail band | `next.putWall`, `next.callWall` | shaded band between the two wall positions | — | band absent when either wall is null |
| **Sort order** | markers laid out sorted by `px` ascending along the rail; label callouts alternate up/down (`side = i%2===0?"dn":"up"`) by that sorted index | | | |
| Rail — whole block empty rule | `marks.length<2` | `railMarks` returns `null` | — | falls through to the "Could not build…" warnbar above |
| Wall band tile | `todayWidth`, `nextWidth` (both `\|callWall-putWall\|`) | `"{nf(today,pxDp)} → {nf(next,pxDp)} pts"` (both known) / `"{nf(next,pxDp)} pts"` (only next known) / `—` | sub: `"{round(pct)}% wider"` or `"{round(pct)}% tighter"` when both known, else static `"structure after the roll"` | `—` when `nextWidth==null` |
| Flip moves to tile | `next?.flip` | `fmtPx(next?.flip, kDp)` | sub `fmtPts(next.flip-closePx) + " from the close"` when both known | sub is `—` otherwise |
| Net GEX rolls to tile | `next?.netGex` | `fmtUsd(next?.netGex ?? null)` | sub `"{round(next.netGex/|totalNetGex|*100)}% of today's book"` when both non-null and `totalNetGex!==0` | sub `"next expiry only"` otherwise |
| Overnight watch tile | `rthHi`, `rthLo` (today's) | `"{fmtPx(rthHi,pxDp)} / {fmtPx(rthLo,pxDp)}"` | sub static: `"today's {sym} RTH high / low · per-minute recorder"` | — |
| Bias box | `next?.netGex`, `nextWidth`, `todayWidth`, `next?.flip`, `closePx`, `next?.putWall` | Multi-clause sentence: `"Positive/Negative gamma into tomorrow"` + width comparison clause (`"but {next} pts of room versus {today} today…"` or `"and tighter than today ({next} vs {today} pts)…"`) + flip-watch clause (`"Watch {flip}: {below it the suppression is gone / above it the suppression comes back} {and {putWall} becomes the target / .}"`) | — | width clause is just `"."` when either width is null; flip-watch clause omitted entirely when `next?.flip==null` or `closePx<=0` |

---

### Section 6 — Journal · Accuracy · Premium

Three columns: Session journal, Level accuracy, Where premium actually went.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Journal header | — | `"Session journal"` + tiny `"{etDate} · saved on this device"` | — | — |
| "Auto-read" stat row | `gradeOf("CW")`, `gradeOf("PW")`, `gradeOf("FLIP")` (this session's grades) | `"{CW.status} call wall · {PW.status} put wall · flip {FLIP.status.toLowerCase()}"` | — | each clause falls back to `—` if that grade is missing |
| Journal textarea | `localStorage[NOTES_KEY][etDate]` | free text, saved on every keystroke | — | placeholder `"What you faded, what you chased, what you'd do differently tomorrow…"` when empty; value blank on first load if `localStorage` read throws (caught silently) |
| Accuracy header | `accRows = log.slice(-10)` (from `localStorage[LOG_KEY]`) | `"Level accuracy"` + tiny `"last {accRows.length} sessions"` | — | — |
| Accuracy empty warnbar | `accRows.length===0` | `"Nothing logged yet. This tab writes one row per session after 16:05 ET — the streak fills in as you use it."` | — | — |
| Accuracy bar chart | one bar per logged session; `score = cw?34:0 + pw?33:0 + inside?33:0` | bar `height = max(6,score)%`; `title=` shows the session's date | — | — |
| Accuracy x-axis labels | first/last `accRows` dates | `date.slice(5)` (MM-DD) × 2 | — | — |
| "Call wall held" stat | `hitRate(r=>r.cw)` over `accRows` | `"{hits} / {accRows.length}"` | — | `—` when `accRows.length===0` |
| "Put wall held" stat | `hitRate(r=>r.pw)` | same shape | — | same |
| "Closed inside" stat | `hitRate(r=>r.inside)` | same shape | — | same |
| "Pinned CORE" stat | `hitRate(r=>r.pinned)` | same shape | — | same |
| **Log-write rule (not directly visible, governs the above)** | a row is appended to `LOG_KEY` once per session, only when: not frozen, `etMin >= RTH_CLOSE_MIN+5` (after 16:05), `hasData` and `rthHi/rthLo/callWall/putWall` all present, and no existing row for `etDate`; capped to the last 20 rows | — | — | — |
| Premium header | `premiumTotal` = Σ over chain of `callMark*callVolume*100 + putMark*putVolume*100` | `"Where premium actually went"` + tiny `"{fmtUsd(premiumTotal,false)} traded"` or `"volume × mark"` if `premiumTotal<=0` | — | — |
| Premium empty warnbar | `premiumRows.length===0` | `"No contract prices on this chain frame, so premium cannot be priced. Everything else on this page is gamma and is unaffected."` | — | — |
| Premium row — strike/side label | `premiumRows[i]` = top-5 legs by `usd = mark*volume*100`, calls and puts ranked together | `"{nf(strike,kDp)}{C/P}"` mono | — | — |
| Premium row — bar | same | `width = (usd/premiumRows[0].usd)*100%`, floor 2% | color `var(--cw)` for calls, `var(--pw)` for puts | — |
| Premium row — value | same | `fmtUsd(usd, false)` (unsigned), colored to match the bar | — | — |
| Premium caption | static | `"Today's VOLUME × the contract's mark — dollars paid, not gamma. OI is deliberately excluded… Green = calls, red = puts, same as the walls above."` | — | — |
| **Sort order** | `premiumRows` = all legs sorted by `usd` descending, top 5 | | | |

---

### Footer bar

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Left status line | `frozen`, `etDate`, `expiry`, `sym`, `closePx`, `em` | `"{Frozen recap for/Recap for} {etDate} · {expiry\|\|"—"} · {sym} {fmtPx(closePx,pxDp)}"` + optional `" · EM ±{nf(em,pxDp)}"` | — | EM clause omitted when `em==null` |
| Right status line | `histState`, `frozen`, `nextState` | `"{intraday ladder: recorded/unavailable} · {frozen session \| next expiry: loaded/unavailable}"` | — | — |

---

## PART B — HISTORICAL RECAP (`HistoricalRecap.tsx`)

Fallback view rendered when the picked past date has **no `premarket_freeze` capture** (no real chain to replay the live tabs against). Built from four independently-reaching, date-keyed stores — see "SYMBOL ROUTING" above for which sections actually honor the picked `symbol`.

### Section 1 — `{sessionLabel(date)} · settled close`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Section right-label | `day?.source` (`useGexLevelsHistory`) | `"SPX"` + optional `" · rebuilt from settled OI"` (source `"theta"`) or `" · recorded live"` (any other source) | — | source clause omitted entirely if `day` hasn't loaded / has no `source` |
| SPX-only warnbar | `symbol !== "SPX"` | `"The per-day history is SPX only — the levels recorder is single-symbol. Everything below describes SPX regardless of the symbol picked above."` | — | shown for any non-SPX symbol selection |
| Loading/error/no-row states | `levelsState` | `"Reading the settled history…"` (loading) / `"The settled history could not be read."` (error) / `"No settled row on file for {date}. That store keeps one row per session indefinitely and back-fills its own gaps from settled OI, so a missing date is usually a market holiday."` (`!day`) | — | — |
| SPX close tile | `day.spot` | `fmtPx(day.spot, 2)` — always 2dp regardless of `pxDp` | sub static `"settled spot"` | — |
| Net GEX tile | `day.dollarGamma` | `fmtUsd(day.dollarGamma)` | value class `chg-pos`/`chg-neg` by sign; sub `"dealers long gamma"`/`"dealers short gamma"` | — |
| 0DTE share tile | `eod?.gex0dte` (`useEodGex`) | `fmtUsd(eod?.gex0dte)` | sub `"ex-0DTE {fmtUsd(gexEx0dte)}"` when present | sub `"not split for this date"` when `gexEx0dte==null` |
| Pin tile | `eod?.pinStrike`, `eod?.pinShare` | `fmtPx(eod?.pinStrike)` (default 0dp) | sub `"{(pinShare*100).toFixed(0)}% of board gamma"` | sub `"no pin recorded"` when `pinShare==null` |
| Call wall level card | `day.resistance`, `day.r2` | `fmtPx(day.resistance)` colored `var(--cw)`; sub `"R2 {fmtPx(day.r2)}"` | — | `—` on either when null |
| Put wall level card | `day.support`, `day.s2` | `fmtPx(day.support)` colored `var(--pw)`; sub `"S2 {fmtPx(day.s2)}"` | — | same |
| Gamma flip level card | `day.neutral`, `day.spot` | `fmtPx(day.neutral)` colored amber | sub `"closed above"` if `spot>=neutral`, `"closed below"` otherwise | sub `—` when `neutral==null` |
| Call/put gamma level card | `day.cpgRatio` | `cpgRatio.toFixed(2)` | sub `"call-heavy book"` if `>=1` else `"put-heavy book"` | `—` when `cpgRatio` falsy (0) |
| Open interest level card | `day.openInt` | `nf(openInt, 0)` | sub static `"calls + puts, whole board"` | `—` when `openInt` falsy |
| "Held inside" bias box | `ladderPath` (from Section-4 ladder, SPX-pinned per the routing note) vs `day.resistance`/`day.support` | `"the session {held under/traded through} the call wall and {held above/traded through} the put wall ({fmtPx(lo)}–{fmtPx(hi)} on the recorded window)."` | bold clauses | box entirely absent when `!ladderPath \|\| !day \|\| day.resistance==null \|\| day.support==null` |
| Cumulative gamma curve (`CurveChart`) | `day.curve` (48-pt cumulative net-GEX curve) | SVG path, `preserveAspectRatio="none"`, violet stroke | zero-crossing line (gray) marks where cumulative gamma flips sign — drawn for visual cross-check against the recorded flip | curve block entirely absent unless `day.curve && day.curve.length>2` |
| Curve — level tick lines | `day.support`(PW,red-dashed) / `day.neutral`(Flip,amber-dashed) / `day.spot`(Close,blue,solid) / `day.resistance`(CW,green-dashed) | vertical line per mark, only if `mark.k` is within `[kMin,kMax]` | Close line solid, others dashed | a mark is silently dropped from `drawn[]` if null or out of the curve's strike range |
| Curve x-axis labels | `kMin`, `kMax` of the curve | `nf(kMin,0)` / `nf(kMax,0)` at left/right | — | — |
| Curve legend row | `drawn` marks | `"{label} {nf(k,0)}"` per mark, colored to match its line | — | only the marks actually drawn appear |
| Curve caption | `curve[last].c`, `curve.length` | `"Running total {fmtUsd(lastCumulative)} across {curve.length} sampled strikes · the curve's zero crossing is the flip the ladder implies"` | — | — |

---

### Section 2 — ES Session Range

*(ES futures bars — not converted to SPX; symbol-independent, always ES.)*

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Section right-label | `es.from`/`es.to` (`useSessionEsBars`, RTH-filtered) | `"{from}–{to} ET · 5m bars"` | — | label omitted entirely when `es==null` |
| Loading/empty/error states | `barState` | `"Reading the {date} ES bars…"` / `"No ES bars stored for {date}."` / `"The ES bars could not be read for {date}."` | — | empty text also covers `barState==="ok" && !es` |
| Open tile | `es.open = bars[0].open \|\| bars[0].close` | `fmtPx(es.open, 2)` | sub static `"first RTH bar"` | — |
| High tile | `es.hi = max(bar.high\|\|close)` | `fmtPx(es.hi, 2)` | sub static `"RTH"` | — |
| Low tile | `es.lo = min(bar.low\|\|close)` | `fmtPx(es.lo, 2)` | sub static `"RTH"` | — |
| Close tile | `es.close` | `fmtPx(es.close, 2)` | sub: colored `fmtPts(close-open)` (`chg-pos`/`chg-neg` by sign) + `" on the session"` | — |
| ES caption | static | `"ES, not SPX. A past session's basis is not knowable from a live quote, so these are not converted — the SPX side of the day is section 1."` | — | — |

---

### Section 3 — How the Levels Behaved

*(honors the picked `symbol` — the one truly symbol-aware section in this file.)*

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Section right-label | — | `"{symbol} · wall log"` | — | — |
| Loading/error/empty states | `wallState` | `"Reading the {date} wall log…"` / `"The wall log could not be read for {date}."` / `"Nothing in the {symbol} wall log for {date}. That recorder writes from 09:29 ET on trading days and only started keeping this symbol at some point — a day before that, a holiday, or a day it was down all read this way. The settled levels in section 1 are unaffected; what is missing here is the intraday GRADE of them."` | — | — |
| Level card — no data (per `LEVEL_ORDER` slot) | `byLevel.get(lvl)` is undefined | name colored per `LEVEL_COLOR`; price `—`; sub `"Not recorded on this session."` | — | this IS the empty-per-level state |
| Level card — name + moves pill | `LEVEL_LABEL[lvl]`, `rec.moves` | name colored (cw/pw/violet); pill `"{moves} {move/moves}"` | plain pill (no tone) | — |
| Level card — price | `rec.last` | `fmtPx(rec.last)` (default 0dp) | — | `—` when null |
| Level card — opened/moved sub-line | `rec.open`, `moved = rec.last-rec.open` | `"opened {fmtPx(rec.open)}"` + optional colored `fmtPts(moved)` | `chg-pos`/`chg-neg` by sign of `moved` | moved clause omitted when `moved==null` or `moved===0` |
| Level card — event chips | `rec.events` | pill per event: `"{at.slice(0,5)} {REACTION_LABEL[reaction] \|\| 'UNGRADED'}"`; `title=` tooltip `"{kind} at {at} · spot {fmtPx(spot_at_hit)}"` | pill tone via `pillClass(REACTION_TONE[reaction])`, or plain `"pill"` if `reaction==null` | `"no touch classified"` (tiny text, no pill) when `rec.events.length===0` |
| Level card — source caption | static | `"graded by the wall log"` | — | — |
| **Sort order** | cards render in fixed `LEVEL_ORDER` = `["call_wall","put_wall","cb"]`; each card's `events` sorted `hit_slot` ascending (set inside `useRecordedWalls`) | | | |
| Move-log header | `moves = log.filter(reason==="change").sort(slot asc)` | `"Every time a level moved on {date} · {n} {move/moves}"` | — | whole block hidden when `moves.length===0` |
| Move-log row | one per move | time `at.slice(0,5)` or `"slot {n}"` mono · level label colored · `"{prev→}new"` mono + colored `fmtPts(delta)` (no `"pts"` suffix here, per HistoricalRecap's `fmtPts`) · `"spot {fmtPx(spot)}"` | delta color `chg-pos`/`chg-neg` | delta clause omitted when `r.delta==null` |
| **Sort order** | move-log rows: `slot` ascending | | | |

---

### Section 4 — Where the Gamma Sat

*(per-minute strike ladder — always SPX regardless of the picked symbol; see routing note above. Pruned to ~2 sessions of retention.)*

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Section right-label | `ladderPath.from`/`.to` | `"ladder covers {from}–{to} ET"` | — | omitted when `ladderPath==null` |
| Loading/error/empty states | `ladderState` | `"Reading the {date} strike ladder…"` / `"The strike ladder could not be read for {date}."` / `"No per-minute ladder retained for {date}. That history is pruned to roughly the last two sessions — it is the one store here that does not go back, and section 1 does not depend on it."` | — | empty text also covers `ladderState==="ok" && !ladderRows.length` |
| Caption | static | `"Ten biggest strikes at the close · bar is the closing net GEX, the right column is what it was at the first recorded print"` | — | — |
| Ladder row — strike | `ladderRows[i].strike` | `nf(strike, 0)` mono | — | — |
| Ladder row — bar | `ladderRows[i].net`, `maxAbs = max(\|net\|)` over the 10 rows | `width = min(100, \|net\|/maxAbs*100)%` | `p` (positive/green) or `n` (negative/red) fill | — |
| Ladder row — close value | `ladderRows[i].net` | `fmtUsd(net)` (HistoricalRecap version — unsigned magnitude, `−` only if negative) | `chg-pos`/`chg-neg` text color by sign | — |
| Ladder row — "from" (open value) | `ladderRows[i].open` = this strike's net GEX at the ladder's first recorded column | `"from {fmtUsd(open)}"`, muted | — | `—` when the strike wasn't present in the first column (`open==null`) |
| **Sort order** | `ladderRows` = last column's cells, top 10 by `\|net\|` descending, then **re-sorted by strike descending** for display | | | |

---

### Section 5 — Session Journal

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Section right-label | — | `"{date} · saved on this device"` | — | — |
| Journal textarea | `localStorage[NOTES_KEY][date]` — **same key as the live tab**, so a note typed here or on the live tab for the same date is one shared note | free text | — | placeholder `"What actually happened on {sessionLabel(date)}?"` when empty |

---

### Closing notice — what a past date cannot show

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Static disclosure warnbar | — | `"Written-vs-traded, the positioned/written split, premium and next-expiry structure are not shown for a past session: each needs that day's own chain — with its marks, volumes and open interest — and nothing stores that per strike per past day. Switch the picker back to today for the full live recap."` | — | always rendered (not conditional) |

This banner is the fallback's explicit acknowledgment of every PostMarketTab panel it does **not** attempt to reproduce: Section 3's Written-vs-Traded and Wall Migration-adjacent detail beyond the ladder table, Section 4's Positioned-vs-Written split, Section 5 (Tomorrow's Map) in its entirety, and Section 6's Premium panel. HistoricalRecap's Level-accuracy and "Auto-read" journal stat (PostMarketTab Section 6) also have no counterpart here.

---
