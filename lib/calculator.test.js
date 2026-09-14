import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateOffer,
  parseMoneyToCents,
  parsePercentageToBasisPoints,
} from "./money.js";
import { findPricing, searchCards } from "./lookup.js";
import { parsePricingCsv } from "./csv-import.js";

const cards = [
  {
    id: "a",
    name: "Luffy",
    card_number: "OP17-001",
    set_code: "OP17",
    set_name: "Future",
  },
  {
    id: "b",
    name: "Luffy",
    card_number: "OP05-060",
    set_code: "OP05",
    set_name: "Awakening",
  },
];
const conditions = [
  { name: "Near Mint", code: "NM" },
  { name: "Lightly Played", code: "LP" },
];

const rejects = (fn, pattern) => assert.throws(fn, pattern);

test("money parses supported values and preserves integer cents", () => {
  assert.deepEqual(
    ["$0.00", "$0.01", "$0.99", "$19.99", "$100.00"].map(parseMoneyToCents),
    [0, 1, 99, 1999, 10000],
  );
  assert.equal(parsePercentageToBasisPoints("60%"), 6000);
  assert.equal(calculateOffer("19.99", "60%").offerCents, 1199);
  assert.equal(calculateOffer(1, 5000).offerCents, 1);
  assert.equal(calculateOffer(10000, 0).offerCents, 0);
  assert.equal(calculateOffer(10000, 10000).offerCents, 10000);
});

test("money rejects malformed, negative, over-precise, and oversized values", () => {
  for (const value of [
    "",
    "-1",
    "1.001",
    "free",
    "$1-$2",
    "90071992547409.92",
  ]) {
    rejects(() => parseMoneyToCents(value), /Price/);
  }
  for (const value of ["-1%", "101%", "60.001%", "sixty", ""]) {
    rejects(() => parsePercentageToBasisPoints(value), /rate|percentage/);
  }
  rejects(() => calculateOffer(-1, 6000), /Invalid calculation/);
});

test("search supports name, number, set code, set name, whitespace, and no results", () => {
  assert.equal(searchCards(cards, " luffy ").length, 2);
  assert.equal(searchCards(cards, "OP17")[0].id, "a");
  assert.equal(searchCards(cards, "awakening")[0].id, "b");
  assert.equal(searchCards(cards, "").length, 0);
  assert.equal(searchCards(cards, "missing").length, 0);
});

test("pricing lookup requires the requested active condition and rejects duplicates", () => {
  const pricing = [
    { card_id: "a", condition_code: "NM", active: true },
    { card_id: "a", condition_code: "LP", active: false },
  ];
  assert.ok(findPricing(pricing, { cardId: "a", conditionCode: "NM" }));
  assert.equal(
    findPricing(pricing, { cardId: "a", conditionCode: "LP" }),
    null,
  );
  rejects(
    () =>
      findPricing(
        [...pricing, { card_id: "a", condition_code: "NM", active: true }],
        { cardId: "a", conditionCode: "NM" },
      ),
    /Ambiguous pricing/,
  );
});

test("CSV parser validates rows, dates, required fields, quoted text, and duplicates", () => {
  const csv = [
    "card_name,set_name,set_code,card_number,condition,reference_market_low,source_name,source_updated_at",
    '"<img onerror=alert(1)>","Future, Alt",OP17,OP17-001,Near Mint,19.99,"Authorized, source",2026-09-01',
    "Luffy,Future,OP17,OP17-001,Near Mint,19.99,Authorized source,2026-09-01",
    "Bad,Future,OP17,OP17-002,Unknown,2.00,Source,2026-09-01",
    "Bad,Future,OP17,,Near Mint,nope,Source,not-a-date",
  ].join("\n");
  const result = parsePricingCsv(csv, conditions);
  assert.equal(result.counts.total, 4);
  assert.equal(result.counts.valid, 1);
  assert.equal(result.counts.errors, 3);
  assert.equal(result.rows[0].reference_cents, 1999);
  assert.equal(result.rows[0].card_name, "<img onerror=alert(1)>");
  assert.match(result.errors[0].message, /Duplicate/);
});

test("CSV preview does not imply deletion of absent records", () => {
  const csv =
    "card_name,set_name,set_code,card_number,condition,reference_market_low,source_name,source_updated_at\nLuffy,Future,OP17,OP17-001,Near Mint,19.99,Source,2026-09-01";
  const result = parsePricingCsv(csv, conditions);
  assert.equal(result.counts.valid, 1);
  assert.equal(result.rows.length, 1);
});
