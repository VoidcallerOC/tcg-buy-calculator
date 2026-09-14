import fs from "node:fs";
const source = JSON.parse(
  fs.readFileSync("/tmp/tcgcsv-categories.json", "utf8"),
);
const rows = source.results
  .map(
    (category) =>
      `| ${String(category.name).replaceAll("|", "\\|")} | ${category.categoryId} | — | — | — | — | — | DISCOVERED |`,
  )
  .join("\n");
const reportPath = "TCGCSV_PRODUCTION_SYNC_REPORT.md";
let report = fs.readFileSync(reportPath, "utf8");
report = report.replace(
  "No category counts are fabricated. The complete table will be populated after the authenticated sync preview and transaction finish.",
  `Live source discovery completed at ${new Date().toISOString()}. TCGCSV returned ${source.results.length} categories. Groups, products, prices, freshness, and failures remain unpopulated because the full transactional sync has not yet been run.\n\n${rows}`,
);
fs.writeFileSync(reportPath, report);
