import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const outputDir = path.resolve("outputs", "spx-ohlc-5m");
const rawPath = path.resolve(outputDir, "spx_raw_5m.json");

const raw = JSON.parse(await fs.readFile(rawPath, "utf8"));
const result = raw.chart?.result?.[0];

if (!result) {
  throw new Error("Missing chart result for ^GSPC");
}

const timestamps = result.timestamp ?? [];
const quote = result.indicators?.quote?.[0] ?? {};
const opens = quote.open ?? [];
const highs = quote.high ?? [];
const lows = quote.low ?? [];
const closes = quote.close ?? [];

const rows = timestamps.map((ts, index) => ({
  timestamp: new Date(ts * 1000),
  open: opens[index],
  high: highs[index],
  low: lows[index],
  close: closes[index],
})).filter((row) =>
  row.open != null &&
  row.high != null &&
  row.low != null &&
  row.close != null
);

if (rows.length === 0) {
  throw new Error("No 5-minute OHLC rows found");
}

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("SPX 5m OHLC");

sheet.getRange(`A1:E${rows.length + 1}`).values = [
  ["Timestamp", "Open", "High", "Low", "Close"],
  ...rows.map((row) => [
    row.timestamp.toLocaleString("sv-SE", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).replace(" ", " "),
    row.open.toFixed(2),
    row.high.toFixed(2),
    row.low.toFixed(2),
    row.close.toFixed(2),
  ]),
];

sheet.getRange(`A1:E${rows.length + 1}`).format.autofitColumns();
sheet.getRange(`A1:A${rows.length + 1}`).format.columnWidthPx = 165;
sheet.getRange(`B1:E${rows.length + 1}`).format.columnWidthPx = 90;

await fs.mkdir(outputDir, { recursive: true });

const inspect = await workbook.inspect({
  kind: "table",
  range: "SPX 5m OHLC!A1:E12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 5,
});
await fs.writeFile(path.join(outputDir, "inspect.ndjson"), inspect.ndjson, "utf8");

const render = await workbook.render({ sheetName: "SPX 5m OHLC", range: "A1:E18", scale: 2 });
const renderBytes = typeof render.bytes === "function" ? await render.bytes() : render.bytes;
await fs.writeFile(path.join(outputDir, "preview.png"), Buffer.from(renderBytes));

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "formula error scan",
});
await fs.writeFile(path.join(outputDir, "formula_scan.ndjson"), formulaErrors.ndjson, "utf8");

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, "SPX_OHLC_5min_Last_5_Days.xlsx"));
