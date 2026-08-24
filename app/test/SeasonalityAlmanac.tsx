// MOVED — this file is dead. Do not edit it; nothing imports it.
//
// The seasonality view now lives in `components/seasonality/` because it is
// mounted TWICE: here in the Test Lab (signed in) and on the PUBLIC
// /explore/seasonality page (signed out). Editing this copy changes nothing on
// either surface — the exact failure mode AGENTS.md opens with.
//
//   components/seasonality/SeasonalityView.tsx     <- was app/test/SeasonalityTab.tsx
//   components/seasonality/SeasonalityAlmanac.tsx
//   components/seasonality/seasonalityData.ts
//
// Safe to delete:  git rm "app/test/SeasonalityTab.tsx" "app/test/SeasonalityAlmanac.tsx" "app/test/seasonalityData.ts"
export {};
