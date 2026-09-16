import test from "node:test";
import assert from "node:assert/strict";
import {
  createJustTcgProvider,
  JustTcgProviderNotConfiguredError,
} from "./justtcg-provider.js";
import { createProductionProvider } from "./provider-factory.js";

const response = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get(name) {
      return headers[name.toLowerCase()] ?? headers[name] ?? null;
    },
  },
  json: async () => body,
});

test("JustTCG provider requires a server-side API key", () => {
  assert.throws(
    () => createJustTcgProvider({ apiKey: "" }),
    JustTcgProviderNotConfiguredError,
  );
});

test("production provider selection has no silent legacy fallback", () => {
  assert.throws(
    () =>
      createProductionProvider({ provider: "tcgcsv", apiKey: "server-key" }),
    /JustTCG is the only production provider/,
  );
});

test("JustTCG provider uses x-api-key and normalizes card variants", async () => {
  const calls = [];
  const provider = createJustTcgProvider({
    apiKey: "server-key",
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/games?limit=100&offset=0"))
        return response({
          data: [{ id: "pokemon", name: "Pokémon" }],
          meta: { hasMore: false },
        });
      if (url.includes("/sets?game=pokemon"))
        return response({
          data: [{ id: "base-set", name: "Base Set" }],
          meta: { hasMore: false },
        });
      if (
        url.includes("/cards?") &&
        url.includes("game=pokemon") &&
        url.includes("set=base-set")
      )
        return response({
          data: [
            {
              id: "charizard",
              tcgplayerId: "42",
              name: "Charizard",
              set_name: "Base Set",
            },
          ],
          meta: { hasMore: false },
        });
      if (url.endsWith("/cards"))
        return response({
          data: [
            {
              tcgplayerId: "42",
              variants: [
                {
                  uuid: "v1",
                  condition: "Near Mint",
                  price: 4.25,
                  lastUpdated: 1780936262,
                },
              ],
            },
          ],
        });
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  const categories = await provider.getCategories();
  const groups = await provider.getGroups(categories[0].categoryId);
  const products = await provider.getProducts({
    categoryId: 1,
    groupId: groups[0].groupId,
  });
  const prices = await provider.getPricing([products[0].provider_product_id]);
  assert.equal(products[0].name, "Charizard");
  assert.equal(prices[0].marketPrice, 4.25);
  assert.equal(prices[0].subTypeName, "Near Mint");
  assert.equal(prices[0].source, "JustTCG");
  assert.equal(
    calls.every(({ options }) => options.headers["x-api-key"] === "server-key"),
    true,
  );
  assert.equal(provider.mapCondition("Near Mint"), "NM");
});

test("JustTCG provider rejects negative prices", async () => {
  const provider = createJustTcgProvider({
    apiKey: "server-key",
    sleepImpl: async () => {},
    fetchImpl: async () =>
      response({
        data: [
          {
            tcgplayerId: "42",
            variants: [{ condition: "Near Mint", price: -1 }],
          },
        ],
      }),
  });
  await assert.rejects(
    () => provider.getPricing(["42"]),
    /Invalid JustTCG price/,
  );
});

test("JustTCG provider retries 429 using Retry-After", async () => {
  const delays = [];
  let attempts = 0;
  const provider = createJustTcgProvider({
    apiKey: "server-key",
    pageSize: 20,
    sleepImpl: async (ms) => delays.push(ms),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1)
        return response(
          { error: "Rate limit exceeded. Please slow down your requests." },
          429,
          { "retry-after": "2" },
        );
      return response({
        data: [{ id: "pokemon", name: "Pokemon" }],
        meta: { hasMore: false },
      });
    },
  });
  const games = await provider.getGames();
  assert.equal(games[0].id, "pokemon");
  assert.equal(attempts, 2);
  assert.equal(delays.includes(2000), true);
});

test("JustTCG provider lowers page size when the plan rejects it", async () => {
  const urls = [];
  const provider = createJustTcgProvider({
    apiKey: "server-key",
    pageSize: 100,
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("limit=100"))
        return response(
          { error: "Limit must be between 1 and 20 for your plan." },
          400,
        );
      return response({
        data: [{ id: "pokemon", name: "Pokemon" }],
        meta: { hasMore: false },
      });
    },
  });
  const games = await provider.getGames();
  assert.equal(games[0].id, "pokemon");
  assert.equal(
    urls.some((url) => url.includes("limit=100")),
    true,
  );
  assert.equal(
    urls.some((url) => url.includes("limit=20")),
    true,
  );
});
