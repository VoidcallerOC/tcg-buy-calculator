// Identification accuracy on a labeled corpus of real-card OCR output.
// Images were real card scans run through the scanner's own preprocessing and
// Tesseract engine (clean and with simulated capture conditions); only the OCR
// text is stored. Catalog searches replay recorded results (identity fields
// only). This measures matching on real OCR evidence; it is not a substitute
// for scanning physical cards with a phone camera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractClues, hasUsableClues } from "../scanner/card-identifier.js";
import { matchCatalog, MATCH_STATUS } from "../scanner/catalog-matcher.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const corpus = load("scanner-ocr-corpus.json");
const catalog = load("scanner-corpus-catalog.json").searches;
const search = async (query, game) => catalog[`${game}|${query}`] ?? [];

async function identify(item) {
  const clues = extractClues(item.passes);
  if (!hasUsableClues(clues))
    return {
      clues,
      match: { status: MATCH_STATUS.NOT_IDENTIFIED, candidates: [] },
    };
  return {
    clues,
    match: await matchCatalog(clues, { selectedGame: "pokemon", search }),
  };
}
const isExpected = (item, card) =>
  card.provider_card_id === item.expected.provider_card_id ||
  item.expected.also_accept.includes(card.provider_card_id);

const results = [];
for (const item of corpus.items) {
  const { match } = await identify(item);
  const rank = item.expected
    ? match.candidates.findIndex((c) => isExpected(item, c.card)) + 1
    : 0;
  results.push({ item, match, rank });
}
const cards = results.filter((r) => r.item.expected);
const controls = results.filter((r) => !r.item.expected);
const count = (rows, fn) => rows.filter(fn).length;

test("corpus summary (measured, reported for the record)", (t) => {
  const byCondition = {};
  for (const r of cards) {
    const c = (byCondition[r.item.condition] ??= { n: 0, first: 0, shown: 0 });
    c.n += 1;
    if (r.rank === 1) c.first += 1;
    if (r.rank >= 1) c.shown += 1;
  }
  t.diagnostic(
    JSON.stringify({
      card_images: cards.length,
      distinct_cards: new Set(cards.map((r) => r.item.image)).size,
      controls: controls.length,
      expected_card_listed_first: count(cards, (r) => r.rank === 1),
      expected_card_listed: count(cards, (r) => r.rank >= 1),
      byCondition,
    }),
  );
  assert.ok(cards.length >= 150 && controls.length >= 3);
});

test("no card image is ever auto-identified as the wrong card", () => {
  const wrong = cards.filter(
    (r) => r.match.status === MATCH_STATUS.IDENTIFIED && r.rank !== 1,
  );
  assert.deepEqual(
    wrong.map((r) => `${r.item.image}/${r.item.condition}`),
    [],
  );
});

test("non-card and unreadable images are never identified as a card", () => {
  for (const r of controls)
    assert.notEqual(r.match.status, MATCH_STATUS.IDENTIFIED, r.item.image);
});

test("an uncertain shortlist never highlights a lead it has no evidence for", () => {
  for (const r of results) {
    if (r.match.status !== MATCH_STATUS.NEEDS_CONFIRMATION || !r.match.leader)
      continue;
    const [first] = r.match.candidates;
    const firstCard = first.card.provider_card_id;
    const rival = r.match.candidates.find(
      (c) => c.card.provider_card_id !== firstCard,
    );
    if (rival) assert.ok(first.score > rival.score, r.item.image);
  }
});

test("names read without a number ask for the number instead of guessing a set", () => {
  for (const r of results) {
    const m = r.match;
    if (m.status !== MATCH_STATUS.NEEDS_CONFIRMATION) continue;
    const anyNumber = m.candidates.some((c) => c.numberMatch);
    const distinct =
      new Set(m.candidates.map((c) => c.card.provider_card_id)).size +
      (m.moreCards ?? 0);
    if (!anyNumber && distinct > 1) {
      assert.equal(m.needsNumber, true, r.item.image);
      assert.equal(m.leader, false, r.item.image);
    }
  }
});

// What the confirmation screen highlights as the likely card: an IDENTIFIED
// card, or the first candidate when the matcher reports a lead.
const highlighted = (r) =>
  r.match.status === MATCH_STATUS.IDENTIFIED ||
  (r.match.status === MATCH_STATUS.NEEDS_CONFIRMATION && r.match.leader);

// Measured on this corpus when the fix landed (2026-10-11). Before it, the
// first candidate was always highlighted: 58 of 163 images highlighted a card
// that was not the one scanned. A change that worsens these counts is a
// regression to investigate, not a number to retune.
const MEASURED = { first: 23, listed: 56, highlightedWrong: 2 };

test("identification does not regress below what was measured", () => {
  assert.ok(
    count(cards, (r) => r.rank === 1) >= MEASURED.first,
    "listed first",
  );
  assert.ok(
    count(cards, (r) => r.rank >= 1) >= MEASURED.listed,
    "listed at all",
  );
});

test("a highlighted card is rarely the wrong one (misread numbers only)", () => {
  const wrong = results.filter((r) => highlighted(r) && r.rank !== 1);
  assert.ok(
    wrong.length <= MEASURED.highlightedWrong,
    wrong.map((r) => `${r.item.image}/${r.item.condition}`).join(", "),
  );
});
