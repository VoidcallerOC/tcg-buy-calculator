// Exact-printing safety across every game the catalog returned variants for.
// Each fixture group is real catalog data (identity fields only): the listings
// that share one printed collector number. Alternate arts, manga, SP, reprints,
// promos and finishes print the same name and number, so text read from a card
// cannot choose between them — and their values can differ several hundredfold.
// A scan must therefore list every such printing, rank none above another, and
// leave the choice to the customer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { correctClues } from "../scanner/card-identifier.js";
import {
  matchCatalog,
  MATCH_STATUS,
  planQueries,
  printedName,
  scoreCandidate,
  variantLabels,
} from "../scanner/catalog-matcher.js";

const { groups } = JSON.parse(
  readFileSync(new URL("./fixtures/provider-variants.json", import.meta.url)),
);

for (const group of groups) {
  // The name printed on most of the group's listings, as OCR would read it.
  const byName = Map.groupBy(group.entries, (entry) => printedName(entry.name));
  const [name, printings] = [...byName].sort(
    (a, b) =>
      new Set(b[1].map((e) => e.provider_card_id)).size -
      new Set(a[1].map((e) => e.provider_card_id)).size,
  )[0];
  const cards = new Set(printings.map((entry) => entry.provider_card_id));

  test(`${group.game} ${group.number} "${name}": every printing listed, none ranked above another`, async () => {
    const clues = correctClues(
      null,
      { name, number: group.number },
      group.game,
    );
    const match = await matchCatalog(clues, {
      selectedGame: group.game,
      search: async (_query, game) =>
        game === group.game ? group.entries : [],
    });
    // One listing with this printed name and number (e.g. Lorcana's two Elsa
    // promos share number 2 but are different characters): it may be
    // identified, and it must be that listing.
    if (printings.length === 1) {
      assert.equal(match.candidates[0].card.id, printings[0].id);
      return;
    }
    assert.equal(match.status, MATCH_STATUS.NEEDS_CONFIRMATION);
    const listed = new Map(
      match.candidates.map((item) => [item.card.id, item]),
    );
    for (const entry of printings)
      assert.ok(
        listed.has(entry.id),
        `missing ${entry.name} [${entry.set_name}] ${entry.printing}`,
      );
    const scores = new Set(
      printings.map((entry) => listed.get(entry.id).score),
    );
    assert.equal(
      scores.size,
      1,
      "printings with the same printed name and number must score equally",
    );
    if (cards.size > 1)
      assert.equal(match.leader, false, "no printing may be highlighted");
  });
}

test("variant labels are not part of the printed name", () => {
  assert.equal(
    printedName("Monkey.D.Luffy (119) (SP) (Gold)"),
    "Monkey.D.Luffy",
  );
  assert.equal(printedName("Nami - OP01-016 (Alternate Art)"), "Nami");
  assert.equal(printedName("Charizard ex - 199/165"), "Charizard ex");
  assert.equal(
    printedName("Shanks (Championship 2023) [Serial Number]"),
    "Shanks",
  );
  // Real names with punctuation are untouched.
  assert.equal(
    printedName("Jace, the Mind Sculptor"),
    "Jace, the Mind Sculptor",
  );
  assert.equal(printedName("Ho-Oh"), "Ho-Oh");
  assert.equal(printedName("Mr. Mime"), "Mr. Mime");
});

test("variantLabels keeps printing tags and drops collector-number tags", () => {
  assert.deepEqual(variantLabels("Monkey.D.Luffy (119) (Alternate Art)"), [
    "Alternate Art",
  ]);
  assert.deepEqual(variantLabels("Nami - OP01-016 (Alternate Art)"), [
    "Alternate Art",
  ]);
  assert.deepEqual(variantLabels("Monkey.D.Luffy (Wanted Poster)"), [
    "Wanted Poster",
  ]);
  assert.deepEqual(variantLabels("Pikachu (Red Cheeks)"), ["Red Cheeks"]);
  assert.deepEqual(
    variantLabels("Shanks (Championship 2023) [Serial Number]"),
    ["Championship 2023", "Serial Number"],
  );
  assert.deepEqual(variantLabels("Nami (OP01-016) (Manga)"), ["Manga"]);
  assert.deepEqual(variantLabels("Jace, the Mind Sculptor"), []);
});

// ---------- Alt-print disambiguation when OCR reads a catalog label ----------

test("OCR of a catalog printing label ranks that alt print above the base", async () => {
  const group = groups.find((g) => g.number === "OP05-119");
  const wanted = group.entries.find((e) => e.name.includes("Wanted Poster"));
  const base = group.entries.find(
    (e) =>
      printedName(e.name) === "Monkey.D.Luffy" && !variantLabels(e.name).length,
  );
  assert.ok(wanted && base);
  // Name + number only: every printing still ties (no silent base preference).
  const plain = correctClues(
    null,
    { name: "Monkey.D.Luffy", number: "OP05-119" },
    group.game,
  );
  assert.equal(
    scoreCandidate(wanted, plain).rank,
    scoreCandidate(base, plain).rank,
  );
  // Distinctive subtitle read from the card (or typed): the Wanted Poster leads.
  const labeled = {
    ...plain,
    names: ["Monkey.D.Luffy", "Wanted Poster"],
    text: "Monkey.D.Luffy\nWanted Poster\nOP05-119",
  };
  const match = await matchCatalog(labeled, {
    selectedGame: group.game,
    search: async () => group.entries,
  });
  assert.equal(match.status, MATCH_STATUS.IDENTIFIED);
  assert.equal(match.candidates[0].card.id, wanted.id);
  assert.ok(match.candidates[0].labelHit >= 0.8);
});

test("OCR phrase 'Alternate Art' prefers alt printings over the plain base", async () => {
  const group = groups.find((g) => g.number === "OP01-016");
  const clues = {
    ...correctClues(null, { name: "Nami", number: "OP01-016" }, group.game),
    text: "Nami\nAlternate Art\nOP01-016",
  };
  const match = await matchCatalog(clues, {
    selectedGame: group.game,
    search: async () => group.entries,
  });
  assert.notEqual(match.status, MATCH_STATUS.NOT_IDENTIFIED);
  const top = match.candidates[0];
  assert.ok(
    variantLabels(top.card.name).some((label) => /alternate art/i.test(label)),
    `expected an Alternate Art listing first, got ${top.card.name}`,
  );
  const base = match.candidates.find(
    (item) =>
      printedName(item.card.name) === "Nami" &&
      variantLabels(item.card.name).length === 0,
  );
  if (base)
    assert.ok(
      (top.rank ?? top.score) > (base.rank ?? base.score),
      "plain Nami must not outrank Alternate Art when that label was read",
    );
});

test("Pokémon Red Cheeks alt is distinguished from base Pikachu when the label is read", async () => {
  const group = groups.find((g) => g.number === "058/102");
  const clues = {
    ...correctClues(null, { name: "Pikachu", number: "58/102" }, group.game),
    names: ["Pikachu", "Red Cheeks"],
    text: "Pikachu\nRed Cheeks\n58/102",
  };
  const match = await matchCatalog(clues, {
    selectedGame: group.game,
    search: async () => group.entries,
  });
  assert.ok(match.candidates.length);
  assert.ok(
    /red cheeks/i.test(match.candidates[0].card.name),
    `expected Red Cheeks lead, got ${match.candidates[0].card.name}`,
  );
  // Same-number finishes of Red Cheeks may still share the lead; plain Pikachu must not.
  for (const item of match.candidates) {
    if (
      (item.rank ?? item.score) >=
      (match.candidates[0].rank ?? match.candidates[0].score)
    )
      assert.ok(
        /red cheeks/i.test(item.card.name),
        `tied lead must be Red Cheeks, got ${item.card.name}`,
      );
  }
});

test("name-only base vs SIR with different numbers stays a confirmation choice", async () => {
  const cards = [
    {
      id: "base",
      provider_card_id: "charizard-ex-006",
      name: "Charizard ex",
      card_number: "006/165",
      set_name: "SV: Scarlet & Violet 151",
      printing: "Holofoil",
    },
    {
      id: "sir",
      provider_card_id: "charizard-ex-199",
      name: "Charizard ex",
      card_number: "199/165",
      set_name: "SV: Scarlet & Violet 151",
      printing: "Holofoil",
      rarity: "Special Illustration Rare",
    },
  ];
  const match = await matchCatalog(
    correctClues(null, { name: "Charizard ex" }, "pokemon"),
    { selectedGame: "pokemon", search: async () => cards },
  );
  assert.equal(match.status, MATCH_STATUS.NEEDS_CONFIRMATION);
  assert.equal(match.leader, false);
  assert.deepEqual(
    match.candidates.map((item) => item.card.card_number).sort(),
    ["006/165", "199/165"],
  );
});

test("collector number for the SIR picks that printing, not the base number", async () => {
  const cards = [
    {
      id: "base",
      provider_card_id: "charizard-ex-006",
      name: "Charizard ex",
      card_number: "006/165",
      set_name: "SV: Scarlet & Violet 151",
      printing: "Holofoil",
    },
    {
      id: "sir",
      provider_card_id: "charizard-ex-199",
      name: "Charizard ex",
      card_number: "199/165",
      set_name: "SV: Scarlet & Violet 151",
      printing: "Holofoil",
      rarity: "Special Illustration Rare",
    },
  ];
  const match = await matchCatalog(
    correctClues(null, { name: "Charizard ex", number: "199/165" }, "pokemon"),
    { selectedGame: "pokemon", search: async () => cards },
  );
  assert.equal(match.status, MATCH_STATUS.IDENTIFIED);
  assert.equal(match.candidates[0].card.id, "sir");
});

test("set name from AI clues prefers the printing in that set among same-number alts", async () => {
  const group = groups.find((g) => g.number === "OP05-119");
  const clues = correctClues(
    null,
    {
      name: "Monkey.D.Luffy",
      number: "OP05-119",
      setName: "Emperors in the New World",
    },
    group.game,
  );
  const match = await matchCatalog(clues, {
    selectedGame: group.game,
    search: async () => group.entries,
  });
  assert.ok(match.candidates.length);
  assert.equal(match.candidates[0].card.set_name, "Emperors in the New World");
  assert.ok(match.candidates[0].setNameMatch);
});

test("a number with a provider rarity suffix (Digimon 'BT16-082 R') matches the printed code", async () => {
  const group = groups.find((g) => g.game === "digimon-card-game");
  const match = await matchCatalog(
    correctClues(null, { number: "BT16-082" }, "digimon-card-game"),
    { selectedGame: "digimon-card-game", search: async () => group.entries },
  );
  assert.ok(match.candidates.length > 0);
  assert.ok(match.candidates.every((item) => item.numberMatch));
});

test("a slash number for a game without its own format is searched in that game", () => {
  // "69/204" has the Pokémon shape; with Lorcana selected it must be searched
  // in Lorcana, and nothing is spent searching Pokémon.
  const plan = planQueries(
    correctClues(null, { name: "Elsa", number: "69/204" }, "disney-lorcana"),
    "disney-lorcana",
  );
  assert.deepEqual(plan, [
    { game: "disney-lorcana", query: "69/204" },
    { game: "disney-lorcana", query: "Elsa" },
  ]);
  // Games with their own format keep their plan.
  const pokemon = planQueries(
    correctClues(null, { name: "Charizard ex", number: "199/165" }, "pokemon"),
    "pokemon",
  );
  assert.deepEqual(pokemon[0], { game: "pokemon", query: "199/165" });
});

// ---------- Real One Piece images: base and parallel/alternate printings ----------

const opCorpus = JSON.parse(
  readFileSync(new URL("./fixtures/scanner-op-corpus.json", import.meta.url)),
);
const opGroups = new Map(
  groups
    .filter((g) => g.game === "one-piece-card-game")
    .map((g) => [g.number, g.entries]),
);

test("One Piece images: a read number lists every printing and highlights none", async () => {
  const { extractClues, hasUsableClues } = await import(
    "../scanner/card-identifier.js"
  );
  let read = 0;
  for (const item of opCorpus.items) {
    const clues = extractClues(item.passes);
    if (!hasUsableClues(clues)) continue;
    const match = await matchCatalog(clues, {
      selectedGame: "one-piece-card-game",
      search: async (query, game) =>
        game === "one-piece-card-game" ? (opGroups.get(query) ?? []) : [],
    });
    const label = `${item.image}/${item.condition}`;
    assert.notEqual(match.status, MATCH_STATUS.IDENTIFIED, label);
    assert.notEqual(match.leader, true, label);
    if (!clues.identifiers.some((i) => i.query === item.number)) continue;
    read += 1;
    const listed = new Set(match.candidates.map((c) => c.card.id));
    for (const entry of opGroups.get(item.number))
      assert.ok(listed.has(entry.id), `${label}: missing ${entry.name}`);
  }
  // Measured 2026-10-11: the number was read on 15 of 141 images, and on 52
  // once OCR confusions in the code were accepted (scanner-onepiece.test.js).
  assert.ok(read >= 52, `number read on ${read} images`);
});
