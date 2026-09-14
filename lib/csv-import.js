import { parseMoneyToCents } from "./money.js";

export const REQUIRED_HEADERS = [
  "card_name",
  "set_name",
  "set_code",
  "card_number",
  "condition",
  "reference_market_low",
  "source_name",
  "source_updated_at",
];

function parseLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) {
      cell += '"';
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  cells.push(cell.trim());
  return cells;
}

export function parsePricingCsv(text, conditions) {
  const lines = String(text)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length) throw new Error("CSV is empty.");
  const headers = parseLine(lines[0]).map((header) => header.toLowerCase());
  const missing = REQUIRED_HEADERS.filter(
    (header) => !headers.includes(header),
  );
  if (missing.length)
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  const conditionCodes = new Map(
    conditions.map((condition) => [
      condition.name.toLocaleLowerCase(),
      condition.code,
    ]),
  );
  const rows = [];
  const errors = [];
  const keys = new Set();
  lines.slice(1).forEach((line, lineIndex) => {
    try {
      const values = parseLine(line);
      const row = Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      );
      const conditionCode = conditionCodes.get(
        row.condition.toLocaleLowerCase(),
      );
      if (!conditionCode)
        throw new Error(`Invalid condition: ${row.condition || "blank"}`);
      const priceCents = parseMoneyToCents(row.reference_market_low);
      const key =
        `${row.set_code}|${row.card_number}|${conditionCode}`.toLocaleLowerCase();
      if (keys.has(key)) throw new Error("Duplicate row in upload.");
      keys.add(key);
      rows.push({
        ...row,
        condition_code: conditionCode,
        reference_cents: priceCents,
      });
    } catch (error) {
      errors.push({ row: lineIndex + 2, message: error.message });
    }
  });
  return {
    rows,
    errors,
    counts: {
      total: lines.length - 1,
      valid: rows.length,
      errors: errors.length,
    },
  };
}
