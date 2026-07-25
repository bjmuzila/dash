// Regenerates the two artifacts the visitor choropleth depends on:
//
//   public/countries-110m.json  — world geometry (world-atlas@2, 110m)
//   src/lib/countryMaps.ts      — feature id ↔ ISO alpha-2 + country names
//
// Run from owner-vite/:
//   npx -y -p world-atlas@2 -p i18n-iso-countries node scripts/gen-country-maps.mjs
//
// Only needed if you want a different resolution (50m/10m are much larger) or a
// newer ISO country list. The committed output is stable otherwise.

import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const topo = require("world-atlas/countries-110m.json");
const countries = require("i18n-iso-countries");

mkdirSync(resolve(root, "public"), { recursive: true });
writeFileSync(resolve(root, "public/countries-110m.json"), JSON.stringify(topo));

const idToA2 = {};
for (const g of topo.objects.countries.geometries) {
  const alpha2 = countries.numericToAlpha2(String(g.id).padStart(3, "0"));
  // A handful of features (Kosovo, N. Cyprus, Somaliland) have no ISO numeric
  // id in world-atlas — they render as "no data" and are skipped here.
  if (alpha2) idToA2[String(g.id)] = alpha2;
}

const names = countries.getNames("en");

writeFileSync(
  resolve(root, "src/lib/countryMaps.ts"),
  `// AUTO-GENERATED — do not hand-edit.
//
// Lookup tables for the visitor choropleth. Generated from world-atlas@2
// (countries-110m) + i18n-iso-countries, so the numeric feature ids in
// public/countries-110m.json line up with the ISO 3166-1 alpha-2 codes
// Cloudflare puts in the cf-ipcountry header.
//
// Regenerate with: npx -y -p world-atlas@2 -p i18n-iso-countries node scripts/gen-country-maps.mjs

/** TopoJSON numeric feature id → ISO 3166-1 alpha-2. */
export const FEATURE_ID_TO_ALPHA2: Record<string, string> = ${JSON.stringify(idToA2, null, 2)};

/** ISO 3166-1 alpha-2 → English country name (covers codes with no map feature). */
export const ALPHA2_NAME: Record<string, string> = ${JSON.stringify(names, null, 2)};
`,
);

console.log(
  `wrote public/countries-110m.json (${topo.objects.countries.geometries.length} features) and src/lib/countryMaps.ts (${Object.keys(idToA2).length} mapped, ${Object.keys(names).length} names)`,
);
