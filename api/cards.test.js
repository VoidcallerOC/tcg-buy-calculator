import test from "node:test";
import assert from "node:assert/strict";
import handler from "./cards.js";

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test("JustTCG endpoint normalizes searched cards and condition prices", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.JUSTTCG_API_KEY;
  process.env.JUSTTCG_API_KEY = "server-only-test-key";
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: [
            {
              id: "one-piece-op14-119-dracule-mihawk",
              name: "Dracule Mihawk",
              number: "OP14-119",
              set: "OP14",
              set_name: "The Azure Sea's Seven",
              variants: [
                { condition: "Near Mint", price: 12.34, uuid: "variant-1" },
                { condition: "Damaged", price: 1.25, uuid: "variant-2" },
              ],
            },
          ],
        };
      },
    };
  };
  const res = responseMock();
  await handler(
    { method: "GET", query: { q: "Dracule Mihawk OP14-119" } },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(request.options.headers["x-api-key"], "server-only-test-key");
  assert.match(request.url, /q=Dracule\+Mihawk\+OP14-119/);
  assert.equal(res.body.cards[0].card_number, "OP14-119");
  assert.equal(res.body.cards[0].pricing.NM.reference_cents, 1234);
  assert.equal(res.body.cards[0].pricing.DMG.reference_cents, 125);
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.JUSTTCG_API_KEY;
  else process.env.JUSTTCG_API_KEY = originalKey;
});

test("JustTCG endpoint does not expose provider errors or work without a key", async () => {
  const originalKey = process.env.JUSTTCG_API_KEY;
  delete process.env.JUSTTCG_API_KEY;
  const res = responseMock();
  await handler({ method: "GET", query: { q: "OP14-119" } }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    error: "Live pricing provider is not configured.",
  });
  if (originalKey !== undefined) process.env.JUSTTCG_API_KEY = originalKey;
});
