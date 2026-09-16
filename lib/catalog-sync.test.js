import test from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryCatalogRepository,
  normalizeCatalogCard,
  syncCatalog,
} from "./catalog-sync.js";

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
