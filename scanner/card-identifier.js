// CardIdentifier: turns OCR output into identification clues. It never picks a
// card; CatalogMatcher does that against the real catalog. Pure and DOM-free.
import { GAME_PATTERNS, normalizeOcrText } from "./game-patterns.js";

// Rules text, card-type words and legal lines that look like names but are not.
const NOT_A_NAME =
  /\b(hp|basic|stage|trainer|item|supporter|stadium|energy|pok[eé]mon|illus|weakness|resistance|retreat|ability|creature|instant|sorcery|enchantment|artifact|planeswalker|legendary|land|character|leader|event|counter|don|effect|trigger|atk|def|level|spell|trap|monster|nintendo|creatures|game ?freak|konami|wizards|coast|bandai|eiichiro|oda|shueisha|toei|disney|copyright|rights|reserved|damage|attack|turn|your|opponent|card|cards|deck|hand|discard)\b/i;

/**
 * @param {{ text: string, confidence?: number, region?: string }[]} passes OCR passes
 * @returns {{ identifiers: object[], names: string[], setCodes: string[], language: string|null, ocrConfidence: number, text: string }}
 */
export function extractClues(passes) {
  const text = passes.map((pass) => normalizeOcrText(pass.text)).join("\n");
  const identifiers = [];
  const setCodes = new Set();
  let language = null;
  for (const entry of GAME_PATTERNS) {
    for (const pattern of entry.patterns) {
      for (const match of text.matchAll(pattern.regex)) {
        const query = pattern.toQuery(match);
        const setCode = pattern.setCode?.(match);
        const lang = pattern.language?.(match);
        if (setCode) setCodes.add(setCode);
        if (lang && !language) language = lang;
        if (
          query &&
          !identifiers.some(
            (item) => item.game === entry.game && item.query === query,
          )
        )
          identifiers.push({
            game: entry.game,
            query,
            setCode: setCode ?? null,
            raw: match[0].trim(),
          });
      }
    }
  }
  const confidences = passes
    .map((pass) => Number(pass.confidence))
    .filter(Number.isFinite);
  return {
    identifiers,
    names: nameCandidates(passes),
    setCodes: [...setCodes],
    language,
    ocrConfidence: confidences.length
      ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
      : 0,
    text,
  };
}

// Lines the OCR engine itself scored below this are noise, not names.
export const MIN_NAME_LINE_CONFIDENCE = 60;

// A pass's lines: the engine's per-line results when present, else its text.
function passLines(pass) {
  if (Array.isArray(pass.lines))
    return pass.lines
      .filter((line) => line.confidence >= MIN_NAME_LINE_CONFIDENCE)
      .map((line) => line.text);
  return normalizeOcrText(pass.text).split("\n");
}

// Plausible card-name lines, best first. Full-card lines come first (most
// games print the name at the top); bottom-strip lines follow (One Piece).
export function nameCandidates(passes) {
  const seen = new Set();
  const names = [];
  const ordered = [
    ...passes.filter((pass) => pass.region !== "bottom"),
    ...passes.filter((pass) => pass.region === "bottom"),
  ];
  for (const pass of ordered) {
    for (const rawLine of passLines(pass)) {
      const line = normalizeOcrText(rawLine)
        .replace(/[^A-Za-z0-9À-ÿ'’.,&:!\- ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const letters = (line.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
      if (
        line.length < 3 ||
        line.length > 40 ||
        letters < 3 ||
        letters / line.length < 0.7
      )
        continue;
      if (!/[A-Za-zÀ-ÿ]{3,}/.test(line)) continue; // needs a real word, not "op TH"
      if (NOT_A_NAME.test(line) && line.split(" ").length > 2) continue;
      const cleaned = line
        .replace(/\s+\d+$/, "")
        .replace(/^(HP|hp)\s*\d*\s*/, "")
        .trim();
      const key = cleaned.toLowerCase();
      if (
        cleaned.length < 3 ||
        seen.has(key) ||
        (NOT_A_NAME.test(cleaned) && cleaned.split(" ").length === 1)
      )
        continue;
      seen.add(key);
      names.push(cleaned);
      if (names.length === 4) return names;
    }
  }
  return names;
}

// What to put in the manual search box when the customer gives up on a scan:
// the name read (easiest to recognise and edit), else the printed identifier.
export function bestSearchQuery(clues) {
  return clues?.names?.[0] ?? clues?.identifiers?.[0]?.query ?? "";
}

export function hasUsableClues(clues) {
  return clues.identifiers.length > 0 || clues.names.length > 0;
}
