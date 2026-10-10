import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler, { collectorNumber, normalizeCard } from "./cards.js";
import {
  JUSTTCG_AUTHORIZATION,
  evaluatePricingAuthorization,
} from "../lib/pricing-authorization.js";

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

function providerResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return status >= 400 ? { error: "provider error" } : { data };
    },
  };
}

// Runs `fn` with a mocked fetch and env, restoring both afterwards.
async function withEnv(env, fetchImpl, fn) {
  const originalFetch = globalThis.fetch;
  const saved = {};
  for (const name of ["JUSTTCG_API_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY"])
    saved[name] = process.env[name];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
const providerOnly = {
  JUSTTCG_API_KEY: "server-only-test-key",
  SUPABASE_URL: undefined,
  SUPABASE_ANON_KEY: undefined,
};
async function search(query, extra = {}) {
  const res = responseMock();
  await handler({ method: "GET", query, headers: {}, ...extra }, res);
  return res;
}

const mihawk = {
  id: "mihawk",
  name: "Dracule Mihawk",
  game: "One Piece Card Game",
  number: "OP14-119",
  set: "OP14",
  set_name: "The Azure Sea's Seven",
  rarity: "Super Rare",
  variants: [
    {
      condition: "Near Mint",
      printing: "Normal",
      language: "English",
      price: 12.34,
      priceStatus: "current",
      lastUpdated: 1791629282,
      uuid: "variant-1",
    },
    {
      condition: "Damaged",
      printing: "Normal",
      language: "English",
      price: 1.25,
      priceStatus: "current",
      lastUpdated: 1791629282,
      uuid: "variant-2",
    },
    {
      condition: "Near Mint",
      printing: "Foil",
      language: "English",
      price: 80,
      priceStatus: "current",
      lastUpdated: 1791629282,
      uuid: "variant-3",
    },
    {
      condition: "Lightly Played",
      printing: "Foil",
      language: "English",
      price: null,
      priceStatus: "unpriced",
      uuid: "variant-4",
    },
    {
      condition: "Moderately Played",
      printing: "Foil",
      language: "English",
      price: 40,
      priceStatus: "expired",
      uuid: "variant-5",
    },
  ],
};

test("splits provider variants by printing so foil prices never price a normal copy", () => {
  const entries = normalizeCard(mihawk);
  assert.equal(entries.length, 2);
  const normal = entries.find((entry) => entry.printing === "Normal");
  const foil = entries.find((entry) => entry.printing === "Foil");
  assert.equal(normal.pricing.NM.reference_cents, 1234);
  assert.equal(normal.pricing.DMG.reference_cents, 125);
  assert.equal(foil.pricing.NM.reference_cents, 8000);
  assert.notEqual(normal.id, foil.id);
  assert.equal(normal.card_number, "OP14-119");
  assert.equal(normal.set_name, "The Azure Sea's Seven");
  assert.equal(normal.pricing.NM.source_updated_at, "2026-10-10T10:48:02.000Z");
  assert.equal(foil.pricing.LP, undefined, "unpriced variants have no price");
  assert.equal(foil.pricing.MP, undefined, "expired prices are not current");
});

test("drops sealed products and conflicting duplicate prices", () => {
  assert.deepEqual(
    normalizeCard({
      id: "box",
      name: "Booster Box",
      number: "N/A",
      variants: [{ condition: "Sealed", price: 100, priceStatus: "current" }],
    }),
    [],
  );
  const [entry] = normalizeCard({
    id: "dup",
    name: "Dup",
    number: "1",
    variants: [
      { condition: "Near Mint", printing: "Normal", price: 1 },
      { condition: "Near Mint", printing: "Normal", price: 2 },
    ],
  });
  assert.equal(entry.pricing.NM, undefined);
});

test("keeps a missing provider timestamp as null rather than inventing one", () => {
  const [entry] = normalizeCard({
    id: "x",
    name: "X",
    number: "1",
    variants: [{ condition: "Near Mint", printing: "Normal", price: 5 }],
  });
  assert.equal(entry.pricing.NM.reference_cents, 500);
  assert.equal(entry.pricing.NM.source_updated_at, null);
});

test("parses printed collector numbers across games", () => {
  assert.equal(collectorNumber("OP14-119"), "OP14-119");
  assert.equal(collectorNumber("Dracule Mihawk OP14-119"), "OP14-119");
  assert.equal(collectorNumber("op05 060"), "OP05-060");
  assert.equal(collectorNumber("OP05060"), "OP05-060");
  assert.equal(collectorNumber("199/165"), "199/165");
  assert.equal(collectorNumber("TG01/TG30"), "TG01/TG30");
  assert.equal(collectorNumber("LOB-EN001"), "LOB-EN001");
  assert.equal(collectorNumber("Luffy OP05"), null);
  assert.equal(collectorNumber("Charizard 151"), null);
  assert.equal(collectorNumber("Luffy-Tarou"), null);
});

test("searches by collector number first and keeps the key server-side", async () => {
  const requests = [];
  await withEnv(
    providerOnly,
    async (url, options) => {
      requests.push({ url: String(url), options });
      return providerResponse([mihawk]);
    },
    async () => {
      const res = await search({ q: "Dracule Mihawk OP14-119" });
      assert.equal(res.statusCode, 200);
      assert.equal(requests.length, 1);
      assert.match(requests[0].url, /number=OP14-119/);
      assert.match(requests[0].url, /game=one-piece-card-game/);
      assert.equal(
        requests[0].options.headers["x-api-key"],
        "server-only-test-key",
      );
      assert.equal(res.body.cards.length, 2);
      assert.equal(res.body.pricing_source, "JustTCG");
      assert.ok(
        res.body.cards.every((card) => card.game === "one-piece-card-game"),
        "cards carry the provider game id, not a display name",
      );
      assert.match(res.headers["Cache-Control"], /s-maxage=300/);
      assert.doesNotMatch(JSON.stringify(res.body), /server-only-test-key/);
    },
  );
});

test("falls back from an empty number search to a text search", async () => {
  const urls = [];
  await withEnv(
    providerOnly,
    async (url) => {
      urls.push(String(url));
      return providerResponse(urls.length === 1 ? [] : [mihawk]);
    },
    async () => {
      const res = await search({ q: "OP14-119" });
      assert.equal(res.statusCode, 200);
      assert.match(urls[0], /number=OP14-119/);
      assert.match(urls[1], /q=OP14-119/);
      assert.equal(res.body.cards[0].card_number, "OP14-119");
    },
  );
});

test("resolves a set name in the query and filters that set by card name", async () => {
  const urls = [];
  await withEnv(
    providerOnly,
    async (url) => {
      const href = String(url);
      urls.push(href);
      if (href.includes("/sets?")) {
        const q = new URL(href).searchParams.get("q");
        return providerResponse(
          q === "151" ? [{ id: "sv-scarlet-violet-151-pokemon" }] : [],
        );
      }
      if (href.includes("set=sv-scarlet-violet-151-pokemon"))
        return providerResponse([
          {
            id: "charizard",
            name: "Charizard ex - 199/165",
            number: "199/165",
            set: "sv-scarlet-violet-151-pokemon",
            set_name: "SV: Scarlet & Violet 151",
            variants: [
              {
                condition: "Near Mint",
                printing: "Holofoil",
                price: 200,
                priceStatus: "current",
              },
            ],
          },
        ]);
      return providerResponse([]);
    },
    async () => {
      const res = await search({ q: "charizard 151", game: "pokemon" });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.cards[0].set_name, "SV: Scarlet & Violet 151");
      assert.ok(urls.length <= 4, "provider requests stay capped");
      assert.ok(
        urls.some((url) =>
          /set=sv-scarlet-violet-151-pokemon.*q=charizard/.test(url),
        ),
      );
    },
  );
});

test("does not work without a server-side key", async () => {
  await withEnv(
    { ...providerOnly, JUSTTCG_API_KEY: undefined },
    async () => {
      throw new Error("must not fetch");
    },
    async () => {
      const res = await search({ q: "OP14-119" });
      assert.equal(res.statusCode, 503);
      assert.deepEqual(res.body, {
        error: "Live pricing provider is not configured.",
      });
      assert.equal(res.headers["Cache-Control"], "no-store");
    },
  );
});

test("maps provider failures to honest gateway statuses", async () => {
  for (const [providerStatus, expected] of [
    [401, 502],
    [403, 502],
    [429, 503],
    [500, 502],
  ]) {
    await withEnv(
      providerOnly,
      async () => providerResponse([], providerStatus),
      async () => {
        const res = await search({ q: "Mihawk" });
        assert.equal(res.statusCode, expected, `provider ${providerStatus}`);
        assert.equal(res.headers["Cache-Control"], "no-store");
        assert.doesNotMatch(res.body.error, /provider error/);
      },
    );
  }
  await withEnv(
    providerOnly,
    async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    },
    async () => {
      const res = await search({ q: "Mihawk" });
      assert.equal(res.statusCode, 504);
    },
  );
});

test("validates method, query length, game, and cross-site use", async () => {
  await withEnv(
    providerOnly,
    async () => {
      throw new Error("must not fetch");
    },
    async () => {
      const post = responseMock();
      await handler({ method: "POST", query: {}, headers: {} }, post);
      assert.equal(post.statusCode, 405);
      assert.equal((await search({ q: "a" })).statusCode, 400);
      assert.equal((await search({ q: "x".repeat(121) })).statusCode, 400);
      assert.equal(
        (await search({ q: "Luffy", game: "../../etc" })).statusCode,
        400,
      );
      const cross = await search(
        { q: "Luffy" },
        { headers: { "sec-fetch-site": "cross-site" } },
      );
      assert.equal(cross.statusCode, 403);
    },
  );
});

test("maps legacy game ids to provider ids", async () => {
  const urls = [];
  await withEnv(
    providerOnly,
    async (url) => {
      urls.push(String(url));
      return providerResponse([mihawk]);
    },
    async () => {
      await search({ q: "Mihawk", game: "flesh-and-blood" });
      assert.match(urls[0], /game=flesh-and-blood-tcg/);
    },
  );
});

const catalogEnv = {
  JUSTTCG_API_KEY: "server-only-test-key",
  SUPABASE_URL: "https://catalog.example.supabase.co",
  SUPABASE_ANON_KEY: "anon-test-key",
};

test("falls back to JustTCG when the indexed catalog request fails", async () => {
  const urls = [];
  await withEnv(
    catalogEnv,
    async (url) => {
      urls.push(String(url));
      if (String(url).includes("supabase.co"))
        return {
          ok: false,
          status: 500,
          async json() {
            return {};
          },
        };
      return providerResponse([mihawk]);
    },
    async () => {
      const res = await search({ q: "OP14-119", game: "one-piece-card-game" });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.source, "provider");
      assert.equal(res.body.cards[0].card_number, "OP14-119");
      assert.ok(urls.some((url) => url.includes("supabase.co")));
      assert.ok(urls.some((url) => url.includes("api.justtcg.com")));
    },
  );
});

test("uses the provider when the indexed catalog does not hold the game", async () => {
  let providerCalled = false;
  await withEnv(
    catalogEnv,
    async (url) => {
      if (String(url).includes("/rest/v1/tcg_games"))
        return {
          ok: true,
          status: 200,
          async json() {
            return [];
          },
        };
      providerCalled = true;
      return providerResponse([mihawk]);
    },
    async () => {
      const res = await search({ q: "Mihawk", game: "pokemon" });
      assert.equal(res.statusCode, 200);
      assert.equal(providerCalled, true);
      assert.equal(res.body.source, "provider");
    },
  );
});

test("keeps empty indexed-catalog results without inventing provider cards", async () => {
  let providerCalled = false;
  await withEnv(
    catalogEnv,
    async (url) => {
      const href = String(url);
      if (href.includes("/rest/v1/tcg_games"))
        return {
          ok: true,
          status: 200,
          async json() {
            return [{ id: "game-1", provider_game_id: "one-piece-card-game" }];
          },
        };
      if (href.includes("/rpc/tcg_catalog_search"))
        return {
          ok: true,
          status: 200,
          async json() {
            return [];
          },
        };
      if (href.includes("api.justtcg.com")) providerCalled = true;
      return providerResponse([{ id: "x", name: "X", number: "OP14-119" }]);
    },
    async () => {
      const res = await search({ q: "OP14-119", game: "one-piece-card-game" });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.source, "indexed-catalog");
      assert.deepEqual(res.body.cards, []);
      assert.equal(providerCalled, false);
    },
  );
});

test("normalizes indexed-catalog variants and active prices by printing", async () => {
  await withEnv(
    catalogEnv,
    async (url) => {
      const href = String(url);
      const ok = (body) => ({
        ok: true,
        status: 200,
        async json() {
          return body;
        },
      });
      if (href.includes("/rest/v1/tcg_games"))
        return ok([{ id: "game-1", provider_game_id: "one-piece-card-game" }]);
      if (href.includes("/rpc/tcg_catalog_search"))
        return ok([
          {
            id: "card-1",
            name: "Mihawk",
            card_number: "OP14-119",
            set_name: "OP14",
            set_code: "OP14",
          },
        ]);
      if (href.includes("/rest/v1/tcg_card_variants"))
        return ok([
          {
            card_id: "card-1",
            provider_variant_id: "v1",
            condition: "Near Mint",
            printing: "Foil",
            language: "English",
            tcg_catalog_prices: [
              {
                reference_cents: 999,
                source_updated_at: "2026-10-09T00:00:00Z",
                active: true,
                condition_code: "NM",
              },
              {
                reference_cents: 1,
                source_updated_at: "2026-01-01T00:00:00Z",
                active: false,
                condition_code: "NM",
              },
            ],
          },
        ]);
      throw new Error(`unexpected ${href}`);
    },
    async () => {
      const res = await search({ q: "Mihawk", game: "one-piece-card-game" });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.source, "indexed-catalog");
      assert.equal(res.body.cards[0].printing, "Foil");
      assert.equal(res.body.cards[0].pricing.NM.reference_cents, 999);
    },
  );
});

test("pricing authorization gate requires a verified paid plan and approved policy", () => {
  assert.equal(evaluatePricingAuthorization().authorized, true);
  for (const change of [
    { commercial_use_status: "UNCLEAR" },
    { derived_pricing_status: "DENIED" },
    { attribution_status: "UNCLEAR" },
    { plan: null },
    { condition_policy_status: "DRAFT" },
  ]) {
    const result = evaluatePricingAuthorization({
      ...JUSTTCG_AUTHORIZATION,
      ...change,
    });
    assert.equal(result.authorized, false, JSON.stringify(change));
    assert.ok(result.blockers.length);
  }
});

test("client configuration mirrors the server-side authorization record", () => {
  const config = JSON.parse(
    readFileSync(new URL("../data/config.json", import.meta.url), "utf8"),
  );
  assert.equal(config.buy_rate, "60%");
  assert.equal(
    config.justtcg_commercial_use_status,
    JUSTTCG_AUTHORIZATION.commercial_use_status,
  );
  assert.equal(
    config.justtcg_derived_pricing_status,
    JUSTTCG_AUTHORIZATION.derived_pricing_status,
  );
  assert.equal(
    config.justtcg_attribution_status,
    JUSTTCG_AUTHORIZATION.attribution_status,
  );
  assert.equal(
    config.condition_policy_status,
    JUSTTCG_AUTHORIZATION.condition_policy_status,
  );
});
