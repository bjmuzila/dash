// Superseded by ./wheelMath.ts on 2026-08-30.
//
// This file and ./SectorWheel.tsx differ only in casing, which resolves to the
// WRONG FILE on Windows: `import('./SectorWheel')` becomes `SectorWheel.ts`,
// the case-insensitive filesystem serves this module instead, and tsc fails
// with TS1149 and "Property 'default' is missing". The pair was renamed to
// wheelMath.ts / SectorWheelCard.tsx.
//
// Emptied rather than deleted because the shell on this machine was down.
// `git rm cbedge-v3/src/pages/tradersDashboard/sectorWheel.ts`
export {}
