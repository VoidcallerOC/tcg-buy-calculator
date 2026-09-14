import test from "node:test";
import assert from "node:assert/strict";
import {
  createTcgplayerProvider,
  TcgplayerProviderNotConfiguredError,
} from "./tcgplayer-provider.js";
import {
  mapCondition,
  normalizeProduct,
  selectReferencePrice,
  freshnessStatus,
} from "./tcgplayer-normalizer.js";
import { runWeeklySync } from "./tcgplayer-sync.js";

const response = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name] ?? null },
  json: async () => body,
});

test("provider refuses missing authorized credentials", () => {
  assert.throws(
    () => createTcgplayerProvider({ credentials: {} }),
    TcgplayerProviderNotConfiguredError,
  );
});

test("provider authenticates officially, paginates, batches pricing, and retries 429", async () => {
  const calls = [];
  let categoryCalls = 0;
  let pricingCalls = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/token"))
      return response({ access_token: "server-only-token", expires_in: 3600 });
    if (url.includes("/catalog/categories")) {
      categoryCalls += 1;
      return categoryCalls === 1
        ? response({
            totalItems: 2,
            results: [{ categoryId: 1, name: "Magic" }],
          })
        : response({
            totalItems: 2,
            results: [{ categoryId: 2, name: "Pokemon" }],
          });
    }
    if (url.includes("/pricing/product/")) {
      pricingCalls += 1;
      if (pricingCalls === 1)
        return response({ success: false, errors: ["rate limited"] }, 429);
      return response({
        results: [
          { productId: 1, marketPrice: 1.23, subTypeName: "Near Mint" },
        ],
      });
    }
    return response({ results: [] });
  };
  const provider = createTcgplayerProvider({
    credentials: { publicKey: "public", privateKey: "private" },
    fetchImpl,
    pageSize: 1,
    sleepImpl: async () => {},
  });
  assert.equal((await provider.getCategories()).length, 2);
  assert.equal((await provider.getPricing([1])).length, 1);
  assert.match(calls[0].options.body.toString(), /client_id=public/);
  assert.match(calls[0].options.body.toString(), /client_secret=private/);
  assert.equal(
    calls.some(
      (call) =>
        call.options.headers?.Authorization === "bearer server-only-token",
    ),
    true,
  );
});

test("normalizer maps only explicit conditions and selects market price", () => {
  assert.equal(mapCondition("Near Mint"), "NM");
  assert.throws(() => mapCondition("Unknown Finish"), /Unmapped/);
  const product = normalizeProduct(
    {
      productId: 7,
      name: "Card",
      categoryId: 1,
      groupId: 2,
      extendedData: [{ name: "Card Number", value: "A-1" }],
    },
    { group: { groupId: 2, name: "Set" } },
  );
  assert.equal(product.provider_product_id, "7");
  assert.equal(
    selectReferencePrice({
      productId: 7,
      marketPrice: 19.99,
      subTypeName: "Near Mint",
    }).reference_cents,
    1999,
  );
  assert.equal(
    selectReferencePrice({ productId: 7, marketPrice: null }).status,
    "UNAVAILABLE",
  );
});

test("freshness distinguishes current, aging, stale, and unknown", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  assert.equal(
    freshnessStatus("2026-09-14", { now, staleThresholdDays: 14 }),
    "CURRENT",
  );
  assert.equal(
    freshnessStatus("2026-09-01", { now, staleThresholdDays: 14 }),
    "AGING",
  );
  assert.equal(
    freshnessStatus("2026-08-01", { now, staleThresholdDays: 14 }),
    "STALE",
  );
  assert.equal(freshnessStatus(null, { now }), "UNKNOWN");
});

test("sync preserves category failure and reports partial results", async () => {
  const provider = {
    provider: "tcgplayer",
    providerVersion: "v1.39.0",
    getCategories: async () => [
      { categoryId: 1, name: "Good" },
      { categoryId: 2, name: "Unavailable" },
    ],
    getGroups: async (categoryId) => {
      if (categoryId === 2)
        throw Object.assign(new Error("rate limited"), { status: 429 });
      return [{ groupId: 10, name: "Set" }];
    },
    getProducts: async () => [
      {
        productId: 7,
        name: "Card",
        categoryId: 1,
        groupId: 10,
        extendedData: [{ name: "Card Number", value: "A-1" }],
      },
    ],
    getPricing: async () => [
      {
        productId: 7,
        marketPrice: 19.99,
        subTypeName: "Near Mint",
        sourceUpdatedAt: "2026-09-14",
      },
    ],
  };
  const result = await runWeeklySync({
    provider,
    clientId: "hard-hittin",
    now: () => new Date("2026-09-14T12:00:00Z"),
  });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.categories_succeeded, 1);
  assert.equal(result.categories_failed, 1);
  assert.equal(result.normalized_prices[0].reference_cents, 1999);
  assert.equal(
    result.categories.find((category) => category.category_id === 2).status,
    "FAILED",
  );
});
