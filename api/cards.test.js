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

function providerResponse(data) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { data };
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
    return providerResponse([
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
    ]);
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

test("JustTCG endpoint retries a combined card-number search with number filters", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.JUSTTCG_API_KEY;
  process.env.JUSTTCG_API_KEY = "server-only-test-key";
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (urls.length < 2) return providerResponse([]);
    return providerResponse([
      {
        id: "mihawk",
        name: "Dracule Mihawk",
        number: "OP14-119",
        set: "op14-one-piece",
        set_name: "The Azure Sea's Seven",
        variants: [{ condition: "Near Mint", price: 10 }],
      },
    ]);
  };
  const res = responseMock();
  await handler({ method: "GET", query: { q: "OP14-119" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cards[0].card_number, "OP14-119");
  assert.match(urls[1], /number=OP14-119/);
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

test("falls back to JustTCG when the indexed catalog request fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.JUSTTCG_API_KEY;
  const originalUrl = process.env.SUPABASE_URL;
  const originalAnon = process.env.SUPABASE_ANON_KEY;
  process.env.JUSTTCG_API_KEY = "server-only-test-key";
  process.env.SUPABASE_URL = "https://catalog.example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test-key";
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes("supabase.co")) {
      return {
        ok: false,
        status: 500,
        async json() {
          return {};
        },
      };
    }
    return providerResponse([
      {
        id: "mihawk",
        name: "Dracule Mihawk",
        number: "OP14-119",
        set: "OP14",
        set_name: "The Azure Sea's Seven",
        variants: [{ condition: "Near Mint", price: 12.34 }],
      },
    ]);
  };
  const res = responseMock();
  await handler(
    { method: "GET", query: { q: "OP14-119", game: "one-piece-card-game" } },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, "provider-fallback");
  assert.equal(res.body.cards[0].card_number, "OP14-119");
  assert.equal(res.body.cards[0].pricing.NM.reference_cents, 1234);
  assert.ok(urls.some((url) => url.includes("supabase.co")));
  assert.ok(urls.some((url) => url.includes("api.justtcg.com")));
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.JUSTTCG_API_KEY;
  else process.env.JUSTTCG_API_KEY = originalKey;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalAnon === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = originalAnon;
});

test("keeps empty indexed-catalog results without inventing provider cards", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.JUSTTCG_API_KEY;
  const originalUrl = process.env.SUPABASE_URL;
  const originalAnon = process.env.SUPABASE_ANON_KEY;
  process.env.JUSTTCG_API_KEY = "server-only-test-key";
  process.env.SUPABASE_URL = "https://catalog.example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test-key";
  let providerCalled = false;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes("/rest/v1/tcg_games")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return [{ id: "game-1", provider_game_id: "one-piece-card-game" }];
        },
      };
    }
    if (href.includes("/rpc/tcg_catalog_search")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return [];
        },
      };
    }
    if (href.includes("api.justtcg.com")) {
      providerCalled = true;
      return providerResponse([{ id: "x", name: "X", number: "OP14-119" }]);
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return [];
      },
    };
  };
  const res = responseMock();
  await handler(
    { method: "GET", query: { q: "OP14-119", game: "one-piece-card-game" } },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, "indexed-catalog");
  assert.deepEqual(res.body.cards, []);
  assert.equal(providerCalled, false);
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.JUSTTCG_API_KEY;
  else process.env.JUSTTCG_API_KEY = originalKey;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalAnon === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = originalAnon;
});
