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

test("money uses integer cents and normal currency rounding", () => {
  assert.equal(parseMoneyToCents("$19.99"), 1999);
  assert.equal(parsePercentageToBasisPoints("60%"), 6000);
  assert.equal(calculateOffer("19.99", "60%").offerCents, 1199);
  assert.equal(calculateOffer(10000, 5000).offerCents, 5000);
  assert.equal(calculateOffer(10000, 7000).offerCents, 7000);
});

test("search returns all matching cards rather than silently selecting one", () => {
  assert.equal(searchCards(cards, "luffy").length, 2);
  assert.equal(searchCards(cards, "OP17")[0].id, "a");
  assert.equal(searchCards(cards, "missing").length, 0);
});

test("pricing lookup distinguishes missing condition and missing price", () => {
  const pricing = [{ card_id: "a", condition_code: "NM", active: true }];
  assert.ok(findPricing(pricing, { cardId: "a", conditionCode: "NM" }));
  assert.equal(
    findPricing(pricing, { cardId: "a", conditionCode: "LP" }),
    null,
  );
});

test("CSV parser validates rows and does not delete absent records", () => {
  const csv =
    "card_name,set_name,set_code,card_number,condition,reference_market_low,source_name,source_updated_at\nLuffy,Future,OP17,OP17-001,Near Mint,19.99,Authorized source,2026-09-01\nLuffy,Future,OP17,OP17-001,Near Mint,19.99,Authorized source,2026-09-01\nBad,Future,OP17,OP17-002,Unknown,2.00,Source,2026-09-01";
  const result = parsePricingCsv(csv, conditions);
  assert.equal(result.counts.valid, 1);
  assert.equal(result.counts.errors, 2);
  assert.equal(result.rows[0].reference_cents, 1999);
});
