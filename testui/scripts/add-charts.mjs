#!/usr/bin/env node
/**
 * Pulls every Bklit UI registry item via the shadcn CLI, one at a time so a
 * single failure doesn't abort the run, then regenerates the charts barrel.
 *
 *   node scripts/add-charts.mjs            # all items
 *   node scripts/add-charts.mjs area-chart # just one (with or without @bklit/)
 *
 * Needs network access to bklit.com.
 */
import { spawnSync } from "node:child_process"
import { ITEMS } from "./registry-items.mjs"

const args = process.argv.slice(2)
const selected = args.length
  ? args.map((a) => (a.startsWith("@bklit/") ? a : `@bklit/${a}`))
  : ITEMS

const failed = []

for (const [i, item] of selected.entries()) {
  process.stdout.write(`\n[${i + 1}/${selected.length}] ${item}\n`)
  const res = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", "shadcn@latest", "add", item, "--yes", "--overwrite"],
    { stdio: "inherit", shell: process.platform === "win32" },
  )
  if (res.status !== 0) failed.push(item)
}

spawnSync(process.execPath, ["scripts/gen-charts-index.mjs"], { stdio: "inherit" })

if (failed.length) {
  console.log(`\n${failed.length} item(s) failed:`)
  for (const f of failed) console.log(`  ${f}`)
  console.log("\nRe-run just those with:  node scripts/add-charts.mjs <name>")
  process.exitCode = 1
} else {
  console.log("\nAll registry items installed.")
}
