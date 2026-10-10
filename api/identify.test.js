import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentifyHandler, toCard } from "./identify.js";

// The Anthropic client is faked: these tests check the request this site
// sends and how responses are handled, not the model's reading accuracy.
function call(handler, { method = "POST", body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(key, value) {
        this.headers[key] = value;
        return this;
      },
      json(payload) {
        resolve({
          status: this.statusCode,
          body: payload,
          headers: this.headers,
        });
        return this;
      },
    };
    handler({ method, headers, body }, res);
  });
}
const IMAGE = Buffer.from("fake-jpeg-bytes").toString("base64");
const modelReply = (output, extra = {}) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(output) }],
  ...extra,
});
const reading = {
  is_trading_card: true,
  game: "pokemon",
  name: "Charizard ex",
  collector_number: "199/165",
  set_name: "Scarlet & Violet 151",
  confidence: "high",
};
function fakeClient(reply) {
  const requests = [];
  return {
    requests,
    createClient: () => ({
      beta: {
        messages: {
          create: async (params) => {
            requests.push(params);
            if (reply instanceof Error) throw reply;
            return reply;
          },
        },
      },
    }),
  };
}

test("GET reports whether AI identification is configured, without the key", async () => {
  const on = await call(
    createIdentifyHandler({ env: { ANTHROPIC_API_KEY: "secret" } }),
    { method: "GET" },
  );
  assert.deepEqual(on.body, { enabled: true });
  assert.equal(on.headers["Cache-Control"], "no-store");
  assert.ok(!JSON.stringify(on.body).includes("secret"));
  const off = await call(createIdentifyHandler({ env: {} }), { method: "GET" });
  assert.deepEqual(off.body, { enabled: false });
});

test("rejects other methods, cross-site requests, missing key, and bad images", async () => {
  const fake = fakeClient(modelReply(reading));
  const handler = createIdentifyHandler({
    env: { ANTHROPIC_API_KEY: "k" },
    createClient: fake.createClient,
  });
  assert.equal((await call(handler, { method: "PUT" })).status, 405);
  assert.equal(
    (
      await call(handler, {
        body: { image: IMAGE },
        headers: { "sec-fetch-site": "cross-site" },
      })
    ).status,
    403,
  );
  for (const body of [
    {},
    { image: "" },
    { image: "not base64!" },
    { image: "A".repeat(2_000_001) },
  ])
    assert.equal((await call(handler, { body })).status, 400);
  const noKey = await call(createIdentifyHandler({ env: {} }), {
    body: { image: IMAGE },
  });
  assert.equal(noKey.status, 503);
  assert.equal(fake.requests.length, 0, "no model call for rejected requests");
});

test("sends one JPEG with a strict schema and server-side fallback, returns clues only", async () => {
  const fake = fakeClient(modelReply(reading));
  const handler = createIdentifyHandler({
    env: { ANTHROPIC_API_KEY: "k" },
    createClient: fake.createClient,
  });
  const result = await call(handler, {
    body: { image: IMAGE, game: "pokemon" },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    card: {
      name: "Charizard ex",
      number: "199/165",
      set_name: "Scarlet & Violet 151",
      game: "pokemon",
      confidence: "high",
    },
  });
  assert.equal(result.headers["Cache-Control"], "no-store");
  const [request] = fake.requests;
  assert.equal(request.model, "claude-opus-5-5");
  assert.deepEqual(request.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(request.fallbacks, "default");
  assert.equal(request.output_config.format.type, "json_schema");
  assert.equal(request.output_config.format.schema.additionalProperties, false);
  const image = request.messages[0].content.find(
    (block) => block.type === "image",
  );
  assert.deepEqual(image.source, {
    type: "base64",
    media_type: "image/jpeg",
    data: IMAGE,
  });
  assert.ok(!JSON.stringify(result.body).match(/price|cents/i));
});

test("the model can be overridden by environment (e.g. a cheaper model)", async () => {
  const fake = fakeClient(modelReply(reading));
  await call(
    createIdentifyHandler({
      env: {
        ANTHROPIC_API_KEY: "k",
        ANTHROPIC_IDENTIFY_MODEL: "claude-haiku-5-5",
      },
      createClient: fake.createClient,
    }),
    { body: { image: IMAGE } },
  );
  assert.equal(fake.requests[0].model, "claude-haiku-5-5");
});

test("not a card, refusal, truncation, bad JSON and API errors never produce a card", async () => {
  const cases = [
    [modelReply({ ...reading, is_trading_card: false }), 200, null],
    [modelReply({ ...reading, name: "", collector_number: "" }), 200, null],
    [modelReply(reading, { stop_reason: "refusal" }), 422],
    [modelReply(reading, { stop_reason: "max_tokens" }), 502],
    [
      { stop_reason: "end_turn", content: [{ type: "text", text: "{oops" }] },
      502,
    ],
    [new Error("network down"), 502],
  ];
  for (const [reply, status, card] of cases) {
    const fake = fakeClient(reply);
    const result = await call(
      createIdentifyHandler({
        env: { ANTHROPIC_API_KEY: "k" },
        createClient: fake.createClient,
      }),
      { body: { image: IMAGE } },
    );
    assert.equal(result.status, status);
    if (status === 200) assert.equal(result.body.card, card);
    else assert.ok(result.body.error);
  }
});

test("toCard cleans text and drops unknown games", () => {
  assert.deepEqual(
    toCard({
      ...reading,
      name: "  Charizard\n ex\u0007 ",
      game: "other",
      confidence: "certain",
    }),
    {
      name: "Charizard ex",
      number: "199/165",
      set_name: "Scarlet & Violet 151",
      game: null,
      confidence: "low",
    },
  );
  assert.equal(toCard(null), null);
});
