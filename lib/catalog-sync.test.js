import test from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryCatalogRepository,
  normalizeCatalogCard,
  syncCatalog,
} from "./catalog-sync.js";
import {
  buildPriceRows,
  parseProviderPrice,
  uniqueBy,
} from "./supabase-catalog-repository.js";

test("normalization keeps game and provider printing identity distinct", () => {
  const a = normalizeCatalogCard(
    {
      uuid: "card-a",
      name: "Energy",
      number: "1",
      variants: [{ uuid: "regular", printing: "Normal" }],
    },
    { provider_game_id: "pokemon", name: "Pokemon" },
    { id: "base", name: "Base Set" },
  );
  const b = normalizeCatalogCard(
    {
      uuid: "card-b",
      name: "Energy",
      number: "1",
      variants: [{ uuid: "holo", printing: "Holofoil" }],
    },
    { provider_game_id: "magic", name: "Magic" },
    { id: "alpha", name: "Alpha" },
  );
  assert.notEqual(
    `${a.provider_game_id}:${a.provider_card_id}`,
    `${b.provider_game_id}:${b.provider_card_id}`,
  );
  assert.equal(a.variants[0].provider_variant_id, "regular");
});

test("null and empty provider prices stay unavailable instead of becoming $0", () => {
  assert.equal(parseProviderPrice(null), null);
  assert.equal(parseProviderPrice(undefined), null);
  assert.equal(parseProviderPrice(""), null);
  assert.equal(parseProviderPrice(0), 0);
  assert.equal(parseProviderPrice(1.25), 1.25);
  const card = normalizeCatalogCard(
    {
      uuid: "jackie",
      name: "Jackie Welles",
      number: "B005",
      variants: [
        { uuid: "lp", condition: "Lightly Played", price: null },
        { uuid: "nm", condition: "Near Mint", price: 38.31 },
      ],
    },
    { provider_game_id: "cyberpunk-tcg", name: "Cyberpunk TCG" },
    { id: "box-toppers", name: "Box Toppers" },
  );
  assert.equal(card.variants[0].price, null);
  assert.equal(card.variants[1].price, 38.31);
});

test("price rows skip unavailable variants and keep one active price per condition", () => {
  const saved = new Map([
    [
      "card-1:lp",
      { id: "variant-lp", provider_variant_id: "lp", card_id: "card-1" },
    ],
    [
      "card-1:nm",
      { id: "variant-nm", provider_variant_id: "nm", card_id: "card-1" },
    ],
  ]);
  const rows = buildPriceRows(saved, [
    {
      card_id: "card-1",
      provider_variant_id: "lp",
      condition: "Lightly Played",
      price: null,
    },
    {
      card_id: "card-1",
      provider_variant_id: "nm",
      condition: "Near Mint",
      price: 38.31,
      provider_updated_at: 1789568383,
    },
    {
      card_id: "card-1",
      provider_variant_id: "nm",
      condition: "Near Mint",
      price: 40,
      provider_updated_at: 1789568383,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].variant_id, "variant-nm");
  assert.equal(rows[0].condition_code, "NM");
  assert.equal(rows[0].reference_cents, 4000);
});

test("uniqueBy keeps the last value for a canonical identity", () => {
  const rows = uniqueBy(
    [
      { id: "a", n: 1 },
      { id: "b", n: 2 },
      { id: "a", n: 3 },
    ],
    (row) => row.id,
  );
  assert.deepEqual(rows, [
    { id: "a", n: 3 },
    { id: "b", n: 2 },
  ]);
});

test("sync consumes every page and is idempotent by canonical identity", async () => {
  const repository = createMemoryCatalogRepository();
  const pages = [
    [{ uuid: "a", name: "A", number: "1" }],
    [{ uuid: "b", name: "B", number: "2" }],
  ];
  const provider = {
    async getGames() {
      return [{ id: "pokemon", provider_game_id: "pokemon", name: "Pokemon" }];
    },
    async getSets() {
      return [{ id: "base", provider_set_id: "base", name: "Base Set" }];
    },
    async *iterCards() {
      for (const data of pages)
        yield { data, limit: 1, meta: { hasMore: data !== pages.at(-1) } };
    },
  };
  const result = await syncCatalog({ provider, repository });
  assert.equal(result.pages, 2);
  assert.equal(repository.cards.size, 2);
  await syncCatalog({ provider, repository });
  assert.equal(repository.cards.size, 2);
  assert.equal(repository.syncs.at(-1).status, "completed");
});

test("sync indexes every set then paginates cards at game level", async () => {
  const repository = createMemoryCatalogRepository();
  const cardCalls = [];
  const provider = {
    async getGames() {
      return [{ id: "pokemon", provider_game_id: "pokemon", name: "Pokemon" }];
    },
    async getSets() {
      return [
        { id: "base", provider_set_id: "base", name: "Base Set" },
        { id: "jungle", provider_set_id: "jungle", name: "Jungle" },
      ];
    },
    async *iterCards(query) {
      cardCalls.push(query);
      yield {
        data: [
          { uuid: "pikachu", name: "Pikachu", number: "25", set: "base" },
          { uuid: "eevee", name: "Eevee", number: "51", set: "jungle" },
        ],
        limit: 20,
        meta: { hasMore: false },
      };
    },
  };
  const result = await syncCatalog({ provider, repository });
  assert.equal(result.sets, 2);
  assert.equal(result.pages, 1);
  assert.equal(result.cards, 2);
  assert.deepEqual(cardCalls, [{ gameId: "pokemon" }]);
  assert.equal(repository.cards.get("pokemon:pikachu").set_name, "Base Set");
  assert.equal(repository.cards.get("pokemon:eevee").set_name, "Jungle");
  assert.equal(repository.syncs.at(-1).games_processed, 1);
});

test("failed syncs resume after fully processed games", async () => {
  const repository = createMemoryCatalogRepository();
  repository.syncs.push({
    id: "sync-0",
    status: "failed",
    games_processed: 1,
    error: "duplicate key",
  });
  const seen = [];
  const provider = {
    async getGames() {
      return [
        {
          id: "cyberpunk-tcg",
          provider_game_id: "cyberpunk-tcg",
          name: "Cyberpunk",
        },
        { id: "pokemon", provider_game_id: "pokemon", name: "Pokemon" },
      ];
    },
    async getSets(gameId) {
      seen.push(gameId);
      return [
        { id: `${gameId}-set`, provider_set_id: `${gameId}-set`, name: "Set" },
      ];
    },
    async *iterCards({ gameId }) {
      yield {
        data: [{ uuid: `${gameId}-card`, name: gameId, number: "1" }],
        limit: 20,
        meta: { hasMore: false },
      };
    },
  };
  const result = await syncCatalog({ provider, repository });
  assert.deepEqual(seen, ["pokemon"]);
  assert.equal(result.games, 2);
  assert.equal(result.cards, 1);
  assert.equal(repository.syncs.at(-1).games_processed, 2);
  assert.equal(repository.syncs.at(-1).status, "completed");
});
