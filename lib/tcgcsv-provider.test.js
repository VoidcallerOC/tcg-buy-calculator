import test from "node:test";
import assert from "node:assert/strict";
import { createTcgcsvProvider } from "./tcgcsv-provider.js";

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => String(body),
});

test("TCGCSV provider uses documented server-side endpoints and explicit mapping", async () => {
  const calls = [];
  const provider = createTcgcsvProvider({
    userAgent: "TestClient/1.0",
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("last-updated.txt"))
        return response("2026-09-14T00:00:00Z");
      if (url.endsWith("/categories"))
        return response({
          success: true,
          results: [{ categoryId: 1, name: "Fixture" }],
        });
      if (url.endsWith("/1/groups"))
        return response({
          success: true,
          results: [{ groupId: 2, name: "Set" }],
        });
      if (url.endsWith("/1/2/products"))
        return response({
          success: true,
          results: [{ productId: 3, name: "Card", categoryId: 1, groupId: 2 }],
        });
      if (url.endsWith("/1/2/prices"))
        return response({
          success: true,
          results: [{ productId: 3, marketPrice: 4.25, subTypeName: "Normal" }],
        });
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  assert.equal((await provider.getCategories())[0].categoryId, 1);
  await provider.getGroups(1);
  await provider.getProducts({ categoryId: 1, groupId: 2 });
  const prices = await provider.getPricing([3]);
  assert.equal(prices[0].marketPrice, 4.25);
  assert.equal(await provider.getLastUpdated(), "2026-09-14T00:00:00Z");
  assert.equal(
    calls.every(
      ({ options }) => options.headers["User-Agent"] === "TestClient/1.0",
    ),
    true,
  );
  assert.throws(() => provider.mapCondition("Normal"), /Unmapped/);
});
