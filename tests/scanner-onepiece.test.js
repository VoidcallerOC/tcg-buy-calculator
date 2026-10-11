// One Piece camera identification: the reported failure (a name read, no
// number read, unrelated crews and sets offered) and the evidence rules that
// fix it. Two kinds of test, kept apart:
//
//   MOCKED OCR — hand-written OCR lines and identities. They pin the parsing
//   and matching rules; they say nothing about how well a camera reads cards.
//
//   REAL OCR — Tesseract output on official card images (clean and with
//   simulated phone, glare and low-light capture), replayed against catalog
//   searches recorded from this site. They measure identification on real OCR
//   text; they are still not phone-camera scans of physical cards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  extractClues,
  hasUsableClues,
  correctClues,
} from "../scanner/card-identifier.js";
import {
  matchCatalog,
  MATCH_STATUS,
  planQueries,
  printedName,
} from "../scanner/catalog-matcher.js";

const OP = "one-piece-card-game";
const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const recorded = load("scanner-op-catalog.json").searches;
const replay = async (query, game) => recorded[`${game}|${query}`] ?? [];

// A full-card pass with line positions (0 = top edge, 1 = bottom edge) and
// the two bottom-strip passes, shaped like scanner/ocr-engine.js output.
const scan = (full, strip = []) => [
  {
    region: "full",
    text: full.map((line) => line.text).join("\n"),
    confidence: 80,
    lines: full.map((line) => ({ confidence: 90, ...line })),
  },
  {
    region: "bottom",
    text: strip.join("\n"),
    confidence: 70,
    lines: strip.map((text) => ({ text, confidence: 90, top: 0.5 })),
  },
];

// ======================= MOCKED OCR =======================

// The layout of the reported card: effect keywords mid-card, art text, the
// name near the bottom edge, the affiliation type line under it, and a
// collector number OCR could not read.
const reported = scan(
  [
    { text: "FOR", top: 0.12 },
    { text: "On Play", top: 0.58 },
    { text: "When Attacking", top: 0.64 },
    { text: "Activate:Main", top: 0.7 },
    { text: "Eustass Kid", top: 0.84 },
    { text: "Kid Pirates", top: 0.89 },
  ],
  ["Kid Pirates", "@"],
);

test("mocked: the reported layout yields the name, never the type line or ability text", () => {
  const clues = extractClues(reported);
  assert.equal(clues.names[0], "Eustass Kid");
  for (const name of clues.names)
    assert.doesNotMatch(name, /pirates|on play|attacking|activate/i, name);
  assert.deepEqual(clues.identifiers, []);
  // The catalog is asked for the name, not for the crew.
  assert.deepEqual(
    planQueries(clues, OP).map((step) => step.query),
    clues.names.slice(0, 2),
  );
});

test("mocked: the old type-line query is what returned other crews (recorded catalog)", async () => {
  // What the scanner used to search for this layout, replayed: every card it
  // returns is a different card from the one scanned.
  const crews = await replay("Kid Pirates", OP);
  assert.ok(crews.length > 0);
  assert.ok(crews.every((card) => !/Eustass/.test(card.name)));
  // Even if a provider returns such cards for the right name, a card that
  // shares no name word with what was read is not offered.
  const match = await matchCatalog(extractClues(reported), {
    selectedGame: OP,
    search: async () => crews,
  });
  assert.equal(match.status, MATCH_STATUS.NOT_IDENTIFIED);
  assert.deepEqual(match.candidates, []);
});

test("mocked: name read, number unreadable: same-name cards across sets, none implied, number asked for", async () => {
  const clues = extractClues(
    scan([
      { text: "When Attacking", top: 0.62 },
      { text: "Roronoa Zoro", top: 0.85 },
      { text: "Straw Hat Crew", top: 0.9 },
    ]),
  );
  const match = await matchCatalog(clues, { selectedGame: OP, search: replay });
  assert.equal(match.status, MATCH_STATUS.NEEDS_CONFIRMATION);
  assert.equal(match.needsNumber, true);
  assert.equal(match.leader, false);
  const names = new Set(match.candidates.map((c) => printedName(c.card.name)));
  assert.deepEqual([...names], ["Roronoa Zoro"]);
  // Different sets, equal scores: nothing ranks one set above another.
  assert.ok(new Set(match.candidates.map((c) => c.card.card_number)).size > 1);
  assert.equal(new Set(match.candidates.map((c) => c.score)).size, 1);
  assert.ok(match.moreCards > 0); // the rest are counted, not hidden silently
});

test("mocked: the typed number then decides between sets; other sets are flagged", async () => {
  const clues = correctClues(
    null,
    { name: "Roronoa Zoro", number: "OP06-118" },
    OP,
  );
  const match = await matchCatalog(clues, { selectedGame: OP, search: replay });
  const numbered = match.candidates.filter((c) => c.numberMatch);
  assert.ok(numbered.length >= 2);
  assert.ok(numbered.every((c) => c.card.card_number === "OP06-118"));
  // Listed first, every printing of that number, none highlighted.
  assert.deepEqual(
    match.candidates.slice(0, numbered.length).map((c) => c.numberMatch),
    numbered.map(() => true),
  );
  assert.equal(match.leader, false);
  for (const other of match.candidates.filter((c) => !c.numberMatch))
    assert.equal(other.numberConflict, true, other.card.name);
});

// Real strings Tesseract produced for the code in the bottom strip of the
// corpus images (see the REAL OCR tests below for how often).
const READ_CODES = [
  ["0P01-001 mm", "OP01-001"],
  ["P0O1-001 “0", "OP01-001"],
  ["opo1-0160m €)", "OP01-016"],
  ["oPot-016Em ©", "OP01-016"],
  ["OP01-0161m €)", "OP01-016"],
  ["oroi- 120d", "OP01-120"],
  ["OPO1- 12168", "OP01-121"],
  ["ORP01-121 E80", "OP01-121"],
  ["OP02- 01363", "OP02-013"],
  ["OP0Z-013Em €)", "OP02-013"],
  ["OP03-122ED @", "OP03-122"],
  ["oP03-12260 €)", "OP03-122"],
  ["OR05-074 EJ", "OP05-074"],
  ["©R05-074 EX", "OP05-074"],
  ["OP05- 11988", "OP05-119"],
  ["OP0G-11868 €)", "OP06-118"],
  ["sT01-01263 ©)", "ST01-012"],
  ["$T01-01260 ©", "ST01-012"],
  ["EB02-019", "EB02-019"],
];

test("mocked: One Piece codes are read through real OCR confusions and glued rarity marks", () => {
  for (const [text, code] of READ_CODES) {
    const ids = extractClues([{ text }]).identifiers.filter(
      (item) => item.game === OP,
    );
    assert.deepEqual(
      ids.map((item) => item.query),
      [code],
      text,
    );
  }
});

test("mocked: text that is not a One Piece code is not read as one", () => {
  for (const text of [
    "OPp1-016 Wm", // set does not read as digits
    "opor-0r0m", // nor here
    "HP 120",
    "-10: Place up to 1",
    "Pro-120 damage",
    "Counter +1000",
    "Weakness x2 Resistance -20",
    "199/165",
    "BT16-082", // Digimon
  ])
    assert.deepEqual(
      extractClues([{ text }]).identifiers.filter((item) => item.game === OP),
      [],
      text,
    );
});

test("mocked: a number misread as another card's code is not accepted on its own", async () => {
  // "OPOS-110" for OP05-119: OP05-110 is a real card (Holly). The name read
  // fits it not at all, so it is not highlighted and the number is queried;
  // the cards the name fits are listed first, with their own numbers shown.
  const clues = extractClues([
    {
      region: "full",
      text: "Monkey.D.Luffy",
      lines: [{ text: "Monkey.D.Luffy", confidence: 90, top: 0.85 }],
    },
    { region: "bottom", text: "OPOS-110ET €)" },
  ]);
  assert.deepEqual(
    clues.identifiers.map((item) => item.query),
    ["OP05-110"],
  );
  const match = await matchCatalog(clues, { selectedGame: OP, search: replay });
  assert.equal(match.leader, false);
  assert.equal(match.checkNumber, true);
  // Several cards carry the name and none the (misread) number: ask for it.
  assert.equal(match.needsNumber, true);
  // The cards the name fits come first, each with its own number shown
  // against the one read; the other card's number match earns no place
  // ahead of them (it is listed after them, or counted as not shown).
  const first = match.candidates[0];
  assert.equal(printedName(first.card.name), "Monkey.D.Luffy");
  assert.equal(first.numberConflict, true);
  const holly = match.candidates.findIndex((c) => c.numberMatch);
  if (holly >= 0) {
    assert.equal(match.candidates[holly].nameConflict, true);
    assert.ok(
      match.candidates
        .slice(0, holly)
        .every((c) => printedName(c.card.name) === "Monkey.D.Luffy"),
    );
  } else assert.ok(match.moreCards > 0);
});

test("mocked: unreadable and unmatched scans say so instead of offering a card", async () => {
  // Nothing readable.
  assert.equal(hasUsableClues(extractClues(scan([]))), false);
  // Only ability text and a type line: nothing is searched as a name.
  const furniture = extractClues(
    scan([
      { text: "When Attacking", top: 0.6 },
      { text: "Once Per Turn", top: 0.66 },
      { text: "Supernovas/Straw Hat Crew", top: 0.9 },
    ]),
  );
  assert.equal(hasUsableClues(furniture), false);
  // A readable name the catalog does not know.
  const unknown = await matchCatalog(
    extractClues(scan([{ text: "Nobody Known", top: 0.85 }])),
    { selectedGame: OP, search: async () => [] },
  );
  assert.equal(unknown.status, MATCH_STATUS.NOT_IDENTIFIED);
});

test("mocked: the type-line rule only applies at the bottom of the card", () => {
  // An affiliation-like name printed at the top of another game's card is
  // still a name; the same words in One Piece's type-line position are not.
  const top = extractClues(scan([{ text: "Goblin Army", top: 0.06 }]));
  assert.deepEqual(top.names, ["Goblin Army"]);
  const bottom = extractClues(scan([{ text: "Goblin Army", top: 0.9 }]));
  assert.deepEqual(bottom.names, []);
});

test("mocked: One Piece's shared middle initial is not a name match", async () => {
  const { nameSimilarity } = await import("../scanner/catalog-matcher.js");
  assert.equal(nameSimilarity("Rocks.D.Xebec", "Monkey.D.Luffy"), 0);
  assert.equal(nameSimilarity("Rocks.D.Xebec", "Rocks.D.Xebec"), 1);
  assert.equal(nameSimilarity("Xebec", "Rocks.D.Xebec") > 0, true);
});

test("mocked: names at the top edge still lead on other games", () => {
  // Edge ordering must not hand Pokémon or Magic names to bottom text.
  const clues = extractClues(
    scan([
      { text: "Primeape", top: 0.06 },
      { text: "Fury Swipes", top: 0.62 },
      { text: "Karate Chop", top: 0.72 },
      { text: "It becomes wildly furious", top: 0.88 },
    ]),
  );
  assert.equal(clues.names[0], "Primeape");
});

// ======================= REAL OCR =======================

const opCorpus = load("scanner-op-corpus.json").items;
const groups = new Map(
  load("provider-variants.json")
    .groups.filter((g) => g.game === OP)
    .map((g) => [g.number, g.entries]),
);
const truthName = (number) => printedName(groups.get(number)[0].name);
const norm = (value) => value.toLowerCase().replace(/[^a-z]/g, "");
const fits = (read, number) => {
  const a = norm(read),
    b = norm(truthName(number));
  return a.length >= 4 && (b.includes(a) || a.includes(b));
};

const runs = [];
for (const item of opCorpus) {
  const clues = extractClues(item.passes);
  const match = hasUsableClues(clues)
    ? await matchCatalog(clues, { selectedGame: OP, search: replay })
    : { status: MATCH_STATUS.NOT_IDENTIFIED, candidates: [] };
  runs.push({ item, clues, match });
}
const count = (fn) => runs.filter(fn).length;

// Measured when this fix landed (2026-10-11) on 147 images: 49 official
// images (base, alternate art, manga, SP and parallel printings of eleven
// codes, including the reported OP17-039) × clean / phone / low light.
// Before the fix: number read on 16, the character's name read first on 51,
// right card listed on 51, and three images offered only other crews ("Kid
// Pirates" → Rocks Pirates, Whitebeard Pirates; "Rocks Pirates" → Rocks
// Pirates, Rock, Rockstar). A change that worsens these is a regression to
// investigate.
const MEASURED = { numberRead: 53, nameFirst: 84, rightCardListed: 77 };

test("real OCR: summary (measured, reported for the record)", (t) => {
  const summary = {
    images: runs.length,
    number_read: count((r) =>
      r.clues.identifiers.some((i) => i.query === r.item.number),
    ),
    name_first: count(
      (r) => r.clues.names[0] && fits(r.clues.names[0], r.item.number),
    ),
    right_card_listed: count((r) =>
      r.match.candidates.some((c) =>
        groups.get(r.item.number).some((e) => e.id === c.card.id),
      ),
    ),
    not_identified: count(
      (r) => r.match.status === MATCH_STATUS.NOT_IDENTIFIED,
    ),
  };
  t.diagnostic(JSON.stringify(summary));
  assert.ok(summary.number_read >= MEASURED.numberRead, "number read");
  assert.ok(summary.name_first >= MEASURED.nameFirst, "name read first");
  assert.ok(
    summary.right_card_listed >= MEASURED.rightCardListed,
    "right card listed",
  );
});

test("real OCR: a type line is never searched as the name", () => {
  for (const r of runs)
    for (const step of planQueries(r.clues, OP))
      assert.doesNotMatch(
        step.query,
        /pirates|\bcrew$|supernovas|emperors/i,
        `${r.item.image}/${r.item.condition}`,
      );
});

test("real OCR: no image is auto-identified, and no printing is highlighted", () => {
  for (const r of runs) {
    const label = `${r.item.image}/${r.item.condition}`;
    assert.notEqual(r.match.status, MATCH_STATUS.IDENTIFIED, label);
    assert.notEqual(r.match.leader, true, label);
  }
});

test("real OCR: a shortlist of only other characters always carries a warning", () => {
  // Before the fix two images offered only other crews with no warning. A
  // misread number can still name another real card (OP05-074 read as
  // OP05-046, OP05-119 as OP08-119); the shortlist then says the number is the
  // only evidence, or that the name read contradicts it.
  const silent = runs.filter((r) => {
    const shown = r.match.candidates;
    if (!shown.length) return false;
    const want = norm(truthName(r.item.number));
    if (shown.some((c) => norm(printedName(c.card.name)) === want))
      return false;
    return !(
      r.match.needsNumber ||
      r.match.checkNumber ||
      r.match.numberOnly ||
      shown.some((c) => c.numberConflict || c.nameConflict)
    );
  });
  assert.deepEqual(
    silent.map((r) => `${r.item.image}/${r.item.condition}`),
    [],
  );
});

test("real OCR: the reported card (OP17-039 Rocks.D.Xebec) is never replaced by its type line or another card", () => {
  // The production failure: this card's type line "Rocks Pirates" (also the
  // name of another card, OP17-056) was searched as its name, and Rocks
  // Pirates and other "Pirate" cards were offered. Real OCR of both
  // printings, clean / phone / low light, replayed against recorded searches.
  const reported = runs.filter((r) => r.item.reported);
  assert.equal(reported.length, 6);
  for (const { item, clues, match } of reported) {
    const label = `${item.image}/${item.condition}`;
    for (const step of planQueries(clues, OP))
      assert.doesNotMatch(step.query, /rocks\s+pir/i, label);
    assert.notEqual(match.leader, true, label);
    if (!match.candidates.length) continue; // admits it cannot identify
    // Whatever is offered first is this character, never another card.
    assert.equal(
      printedName(match.candidates[0].card.name),
      "Rocks.D.Xebec",
      label,
    );
    // When the number is read, both printings of it are offered, equally.
    if (clues.identifiers.some((i) => i.query === "OP17-039")) {
      const numbered = match.candidates.filter((c) => c.numberMatch);
      assert.equal(numbered.length, 2, label);
      assert.equal(numbered[0].score, numbered[1].score, label);
    }
  }
});

test("real OCR: Pokémon card text never yields a One Piece code", () => {
  for (const item of load("scanner-ocr-corpus.json").items)
    assert.deepEqual(
      extractClues(item.passes).identifiers.filter((i) => i.game === OP),
      [],
      item.image,
    );
});
