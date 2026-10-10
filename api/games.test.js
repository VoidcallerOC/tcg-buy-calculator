import test from "node:test";
import assert from "node:assert/strict";
import handler from "./games.js";

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

async function run(env, fetchImpl) {
  const originalFetch = globalThis.fetch;
  const saved = {};
  for (const name of ["JUSTTCG_API_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY"]) {
    saved[name] = process.env[name];
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
  globalThis.fetch = fetchImpl;
  try {
    const res = responseMock();
    await handler({ method: "GET", query: {}, headers: {} }, res);
    return res;
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("lists provider games with only id and name, cached at the CDN", async () => {
  const res = await run({ JUSTTCG_API_KEY: "k" }, async (url, options) => {
    assert.equal(options.headers["x-api-key"], "k");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: [
            { id: "pokemon", name: "Pokemon", cards_count: 1 },
            { id: "flesh-and-blood-tcg", name: "Flesh and Blood TCG" },
            { id: "", name: "broken" },
          ],
        };
      },
    };
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.games, [
    { provider_game_id: "pokemon", name: "Pokemon" },
    { provider_game_id: "flesh-and-blood-tcg", name: "Flesh and Blood TCG" },
  ]);
  assert.match(res.headers["Cache-Control"], /s-maxage/);
});

test("reports an unconfigured provider without fetching", async () => {
  const res = await run({}, async () => {
    throw new Error("must not fetch");
  });
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("does not pass provider failures through as success", async () => {
  const res = await run({ JUSTTCG_API_KEY: "k" }, async () => ({
    ok: false,
    status: 401,
    async json() {
      return { error: "Invalid API key" };
    },
  }));
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: "Game list is unavailable." });
});

test("times out instead of hanging", async () => {
  const res = await run({ JUSTTCG_API_KEY: "k" }, async () => {
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  });
  assert.equal(res.statusCode, 504);
});
