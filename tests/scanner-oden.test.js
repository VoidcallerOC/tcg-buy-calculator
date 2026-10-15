// Regression: Kouzuki Oden full-bleed parallel/alt scanned name-only must not
// shortlist a tournament Uncommon (OP13-063) as the lead. Live JustTCG name
// search returns tournament reprints first; the matcher must demote those and
// surface main-set / parallel listings for confirmation. Number OCR still
// decides when the bottom-corner code is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractClues } from "../scanner/card-identifier.js";
import {
  matchCatalog,
  MATCH_STATUS,
  promoSetPenalty,
  rarityBoost,
} from "../scanner/catalog-matcher.js";
import { correctClues } from "../scanner/card-identifier.js";
import { preprocessCard } from "../scanner/image-preprocessor.js";

// Identity-only snapshot shaped like live /api/cards?q=Kouzuki%20Oden (2026-10-15).
const ODEN_SEARCH = [
  {
    id: "t-op13",
    provider_card_id: "t-op13",
    name: "Kouzuki Oden",
    card_number: "OP13-063",
    set_name: "Carrying On His Will: 3rd Anniversary Tournament Cards",
    printing: "Normal",
    rarity: "Uncommon",
  },
  {
    id: "m-op13",
    provider_card_id: "m-op13",
    name: "Kouzuki Oden",
    card_number: "OP13-063",
    set_name: "Carrying On His Will",
    printing: "Normal",
    rarity: "Uncommon",
  },
  {
    id: "t-op09",
    provider_card_id: "t-op09",
    name: "Kouzuki Oden",
    card_number: "OP09-047",
    set_name: "Emperors in the New World: 2nd Anniversary Tournament Cards",
    printing: "Normal",
    rarity: "Common",
  },
  {
    id: "m-op09",
    provider_card_id: "m-op09",
    name: "Kouzuki Oden",
    card_number: "OP09-047",
    set_name: "Emperors in the New World",
    printing: "Normal",
    rarity: "Common",
  },
  {
    id: "eb01",
    provider_card_id: "eb01",
    name: "Kouzuki Oden",
    card_number: "EB01-001",
    set_name: "Extra Booster: Memorial Collection",
    printing: "Normal",
    rarity: "Leader",
  },
  {
    id: "op12",
    provider_card_id: "op12",
    name: "Kouzuki Oden",
    card_number: "OP12-004",
    set_name: "Legacy of the Master",
    printing: "Normal",
    rarity: "Uncommon",
  },
  {
    id: "op12-release",
    provider_card_id: "op12-release",
    name: "Kouzuki Oden",
    card_number: "OP12-004",
    set_name: "Legacy of the Master Release Event Cards",
    printing: "Normal",
    rarity: "Uncommon",
  },
  {
    id: "op02",
    provider_card_id: "op02",
    name: "Kouzuki Oden",
    card_number: "OP02-030",
    set_name: "Paramount War",
    printing: "Foil",
    rarity: "Super Rare",
  },
  {
    id: "op02-aa",
    provider_card_id: "op02-aa",
    name: "Kouzuki Oden (Alternate Art)",
    card_number: "OP02-030",
    set_name: "Paramount War",
    printing: "Foil",
    rarity: "Super Rare",
  },
  {
    id: "op01",
    provider_card_id: "op01",
    name: "Kouzuki Oden",
    card_number: "OP01-031",
    set_name: "Romance Dawn",
    printing: "Normal",
    rarity: "Leader",
  },
  {
    id: "op01-p",
    provider_card_id: "op01-p",
    name: "Kouzuki Oden (Parallel)",
    card_number: "OP01-031",
    set_name: "Romance Dawn",
    printing: "Foil",
    rarity: "Leader",
  },
];

test("promo/tournament sets are penalised; main-set rares are boosted", () => {
  assert.ok(
    promoSetPenalty(ODEN_SEARCH[0]) >
      promoSetPenalty(ODEN_SEARCH.find((c) => c.id === "op02")),
  );
  assert.ok(
    rarityBoost(ODEN_SEARCH.find((c) => c.id === "op02")) >
      rarityBoost(ODEN_SEARCH[0]),
  );
});

test("name-only Kouzuki Oden does not lead with tournament OP13-063 Uncommon", async () => {
  const match = await matchCatalog(
    correctClues(null, { name: "Kouzuki Oden" }, "one-piece-card-game"),
    {
      selectedGame: "one-piece-card-game",
      search: async () => ODEN_SEARCH,
    },
  );
  assert.equal(match.status, MATCH_STATUS.NEEDS_CONFIRMATION);
  assert.equal(match.leader, false);
  assert.equal(match.needsNumber, true);
  assert.ok(
    !/tournament|release event/i.test(match.candidates[0].card.set_name),
    `shortlist lead was ${match.candidates[0].card.set_name}`,
  );
  assert.ok(
    (match.candidates[0].sortKey ?? 0) >=
      (match.candidates.find((item) => /tournament/i.test(item.card.set_name))
        ?.sortKey ?? -1),
    "main-set / parallel sortKey must beat tournament reprints",
  );
  assert.ok(
    match.candidates.some(
      (item) =>
        item.card.card_number === "OP02-030" ||
        /parallel|alternate art/i.test(item.card.name),
    ),
    "Paramount War / parallel listings must appear for confirmation",
  );
  assert.ok(
    !match.candidates.some((item) =>
      /anniversary tournament/i.test(item.card.set_name),
    ),
    "tournament reprints must not consume the shortlist",
  );
});

test("OP02-030 number read lists Paramount War printings, not OP13-063", async () => {
  const match = await matchCatalog(
    correctClues(
      null,
      { name: "Kouzuki Oden", number: "OP02-030" },
      "one-piece-card-game",
    ),
    {
      selectedGame: "one-piece-card-game",
      search: async (query) => {
        if (/^OP02-030$/i.test(query))
          return ODEN_SEARCH.filter((card) => card.card_number === "OP02-030");
        if (/kouzuki oden/i.test(query)) return ODEN_SEARCH;
        return [];
      },
    },
  );
  assert.equal(match.status, MATCH_STATUS.NEEDS_CONFIRMATION);
  const numbered = match.candidates.filter((item) => item.numberMatch);
  assert.ok(numbered.length >= 2);
  assert.ok(numbered.every((item) => item.card.card_number === "OP02-030"));
  assert.ok(numbered.some((item) => /alternate art/i.test(item.card.name)));
  assert.ok(!numbered.some((item) => item.card.card_number === "OP13-063"));
});

test("One Piece OCR tolerates junk between OP and the set digits", () => {
  for (const text of ["OP 02 - 030", "0P02—030", "OPO TY 02-030", "OP02-030"]) {
    const clues = extractClues([{ text, region: "bottom" }]);
    assert.ok(
      clues.identifiers.some((item) => item.query === "OP02-030"),
      `failed on ${text}: ${JSON.stringify(clues.identifiers)}`,
    );
  }
});

test("preprocessor adds a tight bottom-right strip for OP collector numbers", () => {
  const doc = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingQuality: "",
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData() {},
      }),
    }),
  };
  const regions = preprocessCard({ width: 750, height: 1050 }, doc);
  assert.equal(regions.length, 4);
  assert.equal(
    regions.filter((region) => region.region === "bottom").length,
    3,
  );
});
