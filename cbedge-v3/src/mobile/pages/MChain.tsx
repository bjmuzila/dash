// ─────────────────────────────────────────────────────────────────────────────
// REMOVED 2026-09-03 — the phone Options Chain tab.
//
// The v3 options chain is a strike ladder with up to a dozen numeric columns
// read ACROSS. At 390px that is a horizontal scroll over a table you cannot see
// two columns of at once, which is not the page — it is a picture of the page.
// It goes back in when there is a phone DESIGN for it rather than the desktop
// one made narrow. `/v3/options-chain` is untouched.
//
// THIS FILE IS DEAD AND SHOULD BE DELETED. It is empty rather than gone because
// the session that removed the tab could not delete files on this machine; it
// is kept compiling so `npm run check` does not fail on a file nobody imports.
//
//   git rm cbedge-v3/src/mobile/pages/MChain.tsx
// ─────────────────────────────────────────────────────────────────────────────

export {}
