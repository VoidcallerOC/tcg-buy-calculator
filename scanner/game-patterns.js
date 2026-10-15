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
      // Real camera OCR rarely reads the code cleanly: "0P01-001", "oPo1-0160m",
      // "OPO1- 12168", "OR05-074", "P0O1-001", "sT01-01263". The prefix's
      // letters and digits are confusable, the rarity glyph after the number
      // is read as letters or digits glued to it, and a space can follow the
      // dash. The set's last two characters must read as digits; the number is
      // the first three digit-like characters after the dash.
      {
        regex:
          /(?<![A-Za-z0-9])[O0o©Q]?[PpRr]([A-Za-z0-9]{2,3})\s?-\s?([0-9OoIil]{3})/g,
        toQuery: (m) => setCode("OP", m[1], m[2]),
      },
      // Phone OCR on foil/parallel corners often inserts junk between the
      // prefix and the set ("OPO TY 02-030", "OP 02 - 030", "0P02—030").
      {
        regex:
          /(?<![A-Za-z0-9])[O0o©Q]?[PpRr]\W{0,3}([A-Za-z0-9]{2,3})\W{0,3}[\-—–]\W{0,3}([0-9OoIil]{3})/g,
        toQuery: (m) => setCode("OP", m[1], m[2]),
      },
      {
        regex:
          /(?<![A-Za-z0-9])[O0o©Q]?[PpRr][^0-9]{0,6}(\d{2})\W{0,3}[\-—–]\W{0,3}([0-9OoIil]{3})/g,
        toQuery: (m) => setCode("OP", m[1], m[2]),
      },
      {
        regex: /(?<![0-9])[Ss5$][Tt7]([A-Za-z0-9]{2,3})\s?-\s?([0-9OoIil]{3})/g,
        toQuery: (m) => setCode("ST", m[1], m[2]),
      },
      {
        regex:
          /(?<![A-Za-z0-9])(EB|PRB)([A-Za-z0-9]{2,3})\s?-\s?([0-9OoIil]{3})/gi,
        toQuery: (m) => setCode(m[1].toUpperCase(), m[2], m[3]),
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

// A One Piece code from OCR'd parts, or null when the set does not read as
// two digits ("OPp1-016" is not evidence of any set).
function setCode(prefix, set, number) {
  const look = (value) =>
    String(value)
      .replace(/[OoQD]/g, "0")
      .replace(/[IiltT]/g, "1")
      .replace(/[Ss]/g, "5")
      .replace(/B/g, "8")
      .replace(/G/g, "6")
      .replace(/[Zz]/g, "2");
  const digitsOfSet = look(set).slice(-2);
  if (!/^\d{2}$/.test(digitsOfSet)) return null;
  return `${prefix}${digitsOfSet}-${look(number)}`;
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
