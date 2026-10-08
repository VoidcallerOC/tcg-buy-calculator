// Printed identifiers per game. Add a game by adding an entry; the camera,
// OCR and matching code do not change. `game` values match the calculator's
// game select (provider game ids).
//
// Each pattern runs against OCR text after `normalizeOcrText`. `toQuery`
// returns the canonical printed form used for catalog search and comparison.

const LANGUAGE_CODES = {
  EN: "en",
  JP: "ja",
  JA: "ja",
  DE: "de",
  FR: "fr",
  IT: "it",
  SP: "es",
  ES: "es",
  PT: "pt",
  KR: "ko",
  KO: "ko",
  AE: "en",
  RU: "ru",
};

export const GAME_PATTERNS = [
  {
    game: "one-piece-card-game",
    label: "One Piece",
    patterns: [
      // OCR often doubles the O of OP ("OPO05-119"): accept 2-3 digit-like chars, keep the last two.
      {
        regex: /\b(OP|ST|EB|PRB)\s?([0-9OIlSB]{2,3})\s?-\s?([0-9OIlSB]{3})\b/g,
        toQuery: (m) => `${m[1]}${digits(m[2]).slice(-2)}-${digits(m[3])}`,
      },
      {
        regex: /\bP\s?-\s?([0-9OIlSB]{3})\b/g,
        toQuery: (m) => `P-${digits(m[1])}`,
      },
    ],
  },
  {
    game: "yugioh",
    label: "Yu-Gi-Oh!",
    patterns: [
      {
        regex:
          /\b([A-Z][A-Z0-9]{1,3})\s?-\s?(EN|JP|JA|DE|FR|IT|SP|PT|KR|AE)\s?([0-9OIlSB]{3})\b/g,
        toQuery: (m) => `${m[1]}-${m[2]}${digits(m[3])}`,
        language: (m) => LANGUAGE_CODES[m[2]],
      },
    ],
  },
  {
    game: "magic-the-gathering",
    label: "Magic: The Gathering",
    patterns: [
      // Modern frame: "0107 M" above "DMU • EN".
      {
        regex:
          /\b([0-9OIlSB]{3,4})\s([CURMLSTP])\b[\s\S]{0,12}?\b([A-Z0-9]{3,4})\s?[•·*.]\s?(EN|JA|DE|FR|IT|ES|PT|KO|RU)\b/g,
        toQuery: (m) => String(Number(digits(m[1]))),
        setCode: (m) => m[3],
        language: (m) => LANGUAGE_CODES[m[4]],
      },
      {
        regex: /\b([A-Z0-9]{3,4})\s?[•·*]\s?(EN|JA|DE|FR|IT|ES|PT|KO|RU)\b/g,
        toQuery: () => null,
        setCode: (m) => m[1],
        language: (m) => LANGUAGE_CODES[m[2]],
      },
    ],
  },
  {
    game: "pokemon",
    label: "Pokémon",
    patterns: [
      {
        regex:
          /\b(TG|GG|SV)?([0-9OIlSB]{1,3})\s?\/\s?(TG|GG|SV)?([0-9OIlSB]{2,3})\b/g,
        toQuery: (m) =>
          `${m[1] ?? ""}${digits(m[2])}/${m[3] ?? ""}${digits(m[4])}`,
      },
      {
        regex: /\b(SVP|SWSH|SM|XY)\s?([0-9OIlSB]{2,3})\b/g,
        toQuery: (m) => `${m[1]}${digits(m[2])}`,
      },
    ],
  },
];

// OCR commonly reads digits as look-alike letters inside identifiers.
export function digits(value) {
  return String(value)
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8");
}

export function normalizeOcrText(text) {
  return String(text ?? "")
    .replace(/[‐-―−]/g, "-")
    .replace(/[|\\]/g, "/")
    .replace(/[ \t]+/g, " ");
}

export function gameLabel(game) {
  return GAME_PATTERNS.find((entry) => entry.game === game)?.label ?? game;
}
