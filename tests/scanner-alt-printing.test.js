// One Piece same-number alt-printing: OP12-020 (and similar) must stay
// NEEDS_CONFIRMATION with distinct set/product rows. Learn Together must not
// be buried under ST-32 or tournament/promo reprints; Parallel / Alternate Art
// must stay visible. Confirmation is always mandatory — no IDENTIFIED lead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { correctClues } from "../scanner/card-identifier.js";
import {
  matchCatalog,
  MATCH_STATUS,
  productSortBias,
  promoSetPenalty,
  scoreCandidate,
} from "../scanner/catalog-matcher.js";

// Identity-only snapshot shaped like live /api/cards?q=OP12-020 (2026-10-15).
const ZORO_OP12_020 = [
  {
    id: "lt-zoro",
    provider_card_id: "lt-zoro",
    name: "Roronoa Zoro - OP12-020 (Zoro Deck)",
    card_number: "OP12-020",
    set_name: "Learn Together Deck Set",
    printing: "Foil",
    rarity: "Leader",
  },
  {
    id: "legacy-aa",
    provider_card_id: "legacy-aa",
    name: "Roronoa Zoro (020) (Alternate Art)",
    card_number: "OP12-020",
    set_name: "Legacy of the Master",
    printing: "Foil",
    rarity: "Leader",
  },
  {
    id: "legacy",
    provider_card_id: "legacy",
    name: "Roronoa Zoro (020)",
    card_number: "OP12-020",
    set_name: "Legacy of the Master",
    printing: "Normal",
    rarity: "Leader",
  },
  {
    id: "promo-mat",
    provider_card_id: "promo-mat",
    name: "Roronoa Zoro - OP12-020 (Official Playmat Limited Edition Vol.4)",
    card_number: "OP12-020",
    set_name: "One Piece Promotion Cards",
    printing: "Foil",
    rarity: "Leader",
  },
  {
    id: "promo-serial",
    provider_card_id: "promo-serial",
    name: "Roronoa Zoro (Serial Numbered)",
    card_number: "OP12-020",
    set_name: "One Piece Promotion Cards",
    printing: "Foil",
    rarity: "Leader",
  },
  {
    id: "st32",
    provider_card_id: "st32",
    name: "Roronoa Zoro (OP12-020)",
    card_number: "OP12-020",
    set_name: "ST-32: Starter Deck 32 GREEN Roronoa Zoro",
    printing: "Foil",
    rarity: "Leader",
  },
];

const searchOp12 = async (query) => {
  if (/^OP12-020$/i.test(query)) return ZORO_OP12_020;
  if (/roronoa zoro/i.test(query)) return ZORO_OP12_020;
  return [];
};

test("Learn Together is not treated as a promo set", () => {
  const learn = ZORO_OP12_020.find((c) => c.id === "lt-zoro");
  const st32 = ZORO_OP12_020.find((c) => c.id === "st32");
  const promo = ZORO_OP12_020.find((c) => c.id === "promo-mat");
  assert.equal(promoSetPenalty(learn), 0);
  assert.ok(promoSetPenalty(st32) > 0, "starter decks keep a light demotion");
  assert.ok(
    promoSetPenalty(promo) > promoSetPenalty(st32),
    "true promos demote harder than starters",
  );
  assert.ok(
    productSortBias(learn) > productSortBias(st32),
    "Learn Together must not sort under ST-32",
  );
  assert.ok(
    productSortBias(ZORO_OP12_020.find((c) => c.id === "legacy-aa")) >
      productSortBias(st32),
    "Alternate Art must not sort under ST-32",
  );
  // Numbered bias is promo demotion only — AA must not outrank a plain
  // same-set hit without OCR printing evidence.
  assert.equal(
    productSortBias(ZORO_OP12_020.find((c) => c.id === "legacy-aa")),
    productSortBias(ZORO_OP12_020.find((c) => c.id === "legacy")),
  );
});

test("OP12-020 number read always needs set+printing confirmation", async () => {
  const match = await matchCatalog(
    correctClues(
      null,
      { name: "Roronoa Zoro", number: "OP12-020" },
      "one-piece-card-game",
    ),
    { selectedGame: "one-piece-card-game", search: searchOp12 },
  );
  assert.equal(match.status, MATCH_STATUS.NEEDS_CONFIRMATION);
  assert.equal(match.setChoice, true);
  assert.equal(match.leader, false);
  assert.ok(
    match.setCount >= 3,
    `expected several sets, got ${match.setCount}`,
  );
  const sets = new Set(match.candidates.map((item) => item.card.set_name));
  assert.ok(sets.has("Learn Together Deck Set"), "Learn Together missing");
  assert.ok(
    [...sets].some((set) => /ST-32/i.test(set)),
    "ST-32 starter missing",
  );
  assert.ok(
    match.candidates.some((item) => /alternate art/i.test(item.card.name)),
    "Alternate Art missing",
  );
  assert.ok(
    match.candidates.every((item) => item.card.card_number === "OP12-020"),
  );
});

test("OP12-020 does not bury Learn Together or AA under ST-32 / promos", async () => {
  const match = await matchCatalog(
    correctClues(
      null,
      { name: "Roronoa Zoro", number: "OP12-020" },
      "one-piece-card-game",
    ),
    { selectedGame: "one-piece-card-game", search: searchOp12 },
  );
  const byId = Object.fromEntries(
    match.candidates.map((item) => [item.card.id, item]),
  );
  assert.ok(byId["lt-zoro"], "Learn Together must be on the shortlist");
  assert.ok(byId["legacy-aa"], "Alternate Art must be on the shortlist");
  assert.ok(byId.st32, "ST-32 must still be listed for confirmation");
  assert.ok(
    (byId["lt-zoro"].sortKey ?? 0) >= (byId.st32.sortKey ?? 0),
    "Learn Together must not rank under ST-32",
  );
  assert.ok(
    (byId["legacy-aa"].sortKey ?? 0) >= (byId.st32.sortKey ?? 0),
    "Alternate Art must not rank under ST-32",
  );
  assert.ok(
    (byId["lt-zoro"].sortKey ?? 0) >
      (byId["promo-mat"]?.sortKey ?? byId["promo-serial"]?.sortKey ?? -1),
    "Learn Together must beat promo reprints",
  );
});

test("Parallel / AA same-number group stays NEEDS_CONFIRMATION without a lead", async () => {
  const parallelGroup = [
    {
      id: "pw",
      provider_card_id: "pw",
      name: "Kouzuki Oden",
      card_number: "OP02-030",
      set_name: "Paramount War",
      printing: "Foil",
      rarity: "Super Rare",
    },
    {
      id: "pw-aa",
      provider_card_id: "pw-aa",
      name: "Kouzuki Oden (Alternate Art)",
      card_number: "OP02-030",
      set_name: "Paramount War",
      printing: "Foil",
      rarity: "Super Rare",
    },
    {
      id: "pw-p",
      provider_card_id: "pw-p",
      name: "Kouzuki Oden (Parallel)",
      card_number: "OP02-030",
      set_name: "Paramount War",
      printing: "Foil",
      rarity: "Super Rare",
    },
    {
      id: "st-reprint",
      provider_card_id: "st-reprint",
      name: "Kouzuki Oden",
      card_number: "OP02-030",
      set_name: "ST-03: Starter Deck 03",
      printing: "Normal",
      rarity: "Super Rare",
    },
  ];
  const match = await matchCatalog(
    correctClues(
      null,
      { name: "Kouzuki Oden", number: "OP02-030" },
      "one-piece-card-game",
    ),
    {
      selectedGame: "one-piece-card-game",
      search: async () => parallelGroup,
    },
  );
  assert.equal(match.status, MATCH_STATUS.NEEDS_CONFIRMATION);
  assert.equal(match.setChoice, true);
  assert.equal(match.leader, false);
  assert.ok(match.candidates.some((item) => /parallel/i.test(item.card.name)));
  assert.ok(
    match.candidates.some((item) => /alternate art/i.test(item.card.name)),
  );
  assert.ok(match.candidates.some((item) => /ST-03/i.test(item.card.set_name)));
});

test("equal evidence ranks cannot invent IDENTIFIED for OP12-020", () => {
  const clues = correctClues(
    null,
    { name: "Roronoa Zoro", number: "OP12-020" },
    "one-piece-card-game",
  );
  const ranks = ZORO_OP12_020.map((card) => scoreCandidate(card, clues).rank);
  assert.ok(ranks.every((rank) => rank === ranks[0]));
  assert.ok(
    ranks[0] < 1.2,
    "plain same-number hits must stay below IDENTIFIED",
  );
});
