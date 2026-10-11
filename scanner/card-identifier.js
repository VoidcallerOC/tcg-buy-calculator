// CardIdentifier: turns OCR output into identification clues. It never picks a
// card; CatalogMatcher does that against the real catalog. Pure and DOM-free.
import { GAME_PATTERNS, normalizeOcrText } from "./game-patterns.js";

// Rules text, card-type words and legal lines that look like names but are not.
const NOT_A_NAME =
  /\b(hp|basic|stage|trainer|item|supporter|stadium|energy|pok[eé]mon|illus|weakness|resistance|retreat|ability|creature|instant|sorcery|enchantment|artifact|planeswalker|legendary|land|character|leader|event|counter|don|effect|trigger|atk|def|level|spell|trap|monster|nintendo|creatures|game ?freak|konami|wizards|coast|bandai|eiichiro|oda|shueisha|toei|disney|copyright|rights|reserved|damage|attack|turn|your|opponent|card|cards|deck|hand|discard|flip|coin|heads|tails|attached|defending|asleep|confused|paralyzed|poisoned|burned|knocked|evolves|rule|when|main|activate|played|blocker|banish|this|also|reveal|life)\b/i;

// Card furniture that is never the card's name, whatever its length: the
// evolution line ("Evolves from Mankey"), the illustrator credit (OCR reads
// "Illus." as "lus." or "Hllus."), the weakness/resistance/retreat row, rule
// boxes ("Pokémon-EX rule") and the card-type line ("Basic Pokémon").
const CARD_FURNITURE =
  /evolves?\s*from|^\W*put\s|^\W*\w{0,2}l+us\b|^\W*hus\b|\b(weakness|resistance|retreat)\b|\brule$|pok[eé]mon$/i;
// One Piece ability keywords open the effect text in the middle of the card
// ("On Play", "When Attacking", "Activate:Main", "Once Per Turn"), often
// OCR-cut ("When J", "Per Tu", "Gn Piay"). They read as short capitalised
// phrases, so the generic filters let them through as names.
const ABILITY_KEYWORD =
  /^\W*([og]n\s*p\w*a\w*y|when\s+(att|\W*\w{0,2}$)|activate\b|once\s*per|per\s*tu|on\s*k\.?\s*o|on\s*block|double\s*at|end\s*of\s*your)|\battacking\b/i;
// One Piece prints the character's affiliation in a type line directly under
// the name ("Kid Pirates", "Supernovas/Straw Hat Crew", "The Four Emperors/
// Red-Haired Pirates"). It sits where a name sits, so it outranked the name
// and was searched as one, returning unrelated crews. The line is recognised
// by its opening or closing affiliation word, including OCR cut-offs
// ("Rocks Pir", "Kid Pirat"), and
// only in the bottom quarter of the card, where One Piece prints it: a name
// printed at the top of another game's card ("… Army") is never dropped.
const AFFILIATION_LINE =
  /^\W*(the\s+four\b|\w*pern\w*|\w*novas\b)|\b(\w*pira\w*|pir\w*|\w*rirat\w*|crew|cre|crow|navy|marines?|emperors?|emp|warlords?|kingdom|government|army)\W*$/i;
// Longer lines are flavor or rules text: printed names run to five words.
const MAX_NAME_WORDS = 5;

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
// Full-card lines are read from the card's edges inwards when the engine
// reports positions: names are printed at an edge — the top on Pokémon, Magic
// and Yu-Gi-Oh!, the bottom on One Piece — while ability and rules text fill
// the middle. Reading top-down put One Piece effect keywords ("When
// Attacking") ahead of the name printed below them.
const edgeDistance = (line) => Math.min(line.top, 1 - line.top);
function passLines(pass) {
  if (Array.isArray(pass.lines)) {
    const lines = pass.lines.filter(
      (line) => line.confidence >= MIN_NAME_LINE_CONFIDENCE,
    );
    if (
      pass.region !== "bottom" &&
      lines.every((line) => Number.isFinite(line.top))
    )
      lines.sort((a, b) => edgeDistance(a) - edgeDistance(b));
    return lines
      .filter((line) => !isAttackRow(pass, line))
      .map((line) => ({ text: line.text, low: isLow(pass, line) }));
  }
  return normalizeOcrText(pass.text)
    .split("\n")
    .map((text) => ({ text, low: true }));
}
// An attack ("Corkscrew Punch … 50"): a line in the middle of the card that
// shares its row with a damage number. Attack names are printed in plain bold
// type, so OCR often reads them better than the stylised card name and they
// were searched as the name.
const DAMAGE = /^\d{2,3}\s*[+×x]?$/;
const isAttackRow = (pass, line) =>
  pass.region !== "bottom" &&
  Number.isFinite(line.top) &&
  line.top > 0.3 &&
  line.top < 0.8 &&
  !DAMAGE.test(line.text.trim()) &&
  pass.lines.some(
    (other) =>
      other !== line &&
      Number.isFinite(other.top) &&
      Math.abs(other.top - line.top) < 0.04 &&
      DAMAGE.test(String(other.text).trim()),
  );
// In the bottom quarter of the card, or position unknown.
const isLow = (pass, line) =>
  pass.region === "bottom" || !Number.isFinite(line.top) || line.top > 0.75;

// Plausible card-name lines, best first. Full-card lines come first; bottom-
// strip lines follow. Lines with no lowercase letter come after the rest:
// art and speech text on alternate arts ("FOR", "KING!", "ALIVE") and cut-off
// type words ("CHARACTER" read as "RALIER") are capitals, while most names are
// printed in mixed case. They are kept (Lorcana prints names in capitals),
// only ranked lower.
export function nameCandidates(passes) {
  const seen = new Set();
  const names = [];
  const shouted = [];
  const ordered = [
    ...passes.filter((pass) => pass.region !== "bottom"),
    ...passes.filter((pass) => pass.region === "bottom"),
  ];
  for (const pass of ordered) {
    for (const { text: rawLine, low } of passLines(pass)) {
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
      if (CARD_FURNITURE.test(line)) continue;
      if (ABILITY_KEYWORD.test(line)) continue;
      if (low && AFFILIATION_LINE.test(line)) continue;
      // Rules sentences end in punctuation ("…Defending Pokémon."); names don't.
      if (/[.,;:]$/.test(line)) continue;
      // Printed names start with a capital or digit; a lowercase start is a
      // fragment of a longer line ("resistan", "to become so angry…").
      if (/^[a-zß-ÿ]/.test(line)) continue;
      if (line.split(" ").length > MAX_NAME_WORDS) continue;
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
      (/[a-zß-ÿ]/.test(cleaned) ? names : shouted).push(cleaned);
    }
  }
  return [...names, ...shouted].slice(0, 4);
}

// What to put in the manual search box when the customer gives up on a scan:
// the name read (easiest to recognise and edit), else the printed identifier.
export function bestSearchQuery(clues) {
  return clues?.names?.[0] ?? clues?.identifiers?.[0]?.query ?? "";
}

export function hasUsableClues(clues) {
  return clues.identifiers.length > 0 || clues.names.length > 0;
}

// Owner/customer correction of a scan: what they typed replaces what was read.
// A typed number is run through the same per-game patterns (so "OP0S-1l9"
// still becomes OP05-119 and its game is recognised); a number no pattern
// knows is searched as typed in the selected game. Nothing else is inferred.
export function correctClues(clues, { name, number } = {}, fallbackGame) {
  const typedName = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const typedNumber = String(number ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  let identifiers = [];
  if (typedNumber) {
    identifiers = extractClues([{ text: typedNumber }]).identifiers;
    if (!identifiers.some((item) => item.query))
      identifiers = fallbackGame
        ? [
            {
              game: fallbackGame,
              query: typedNumber.toUpperCase(),
              setCode: null,
              raw: typedNumber,
            },
          ]
        : [];
  }
  return {
    identifiers: identifiers.filter((item) => item.query),
    names: typedName ? [typedName] : [],
    setCodes: clues?.setCodes ?? [],
    language: clues?.language ?? null,
    ocrConfidence: clues?.ocrConfidence ?? 0,
    text: clues?.text ?? "",
    corrected: true,
  };
}
