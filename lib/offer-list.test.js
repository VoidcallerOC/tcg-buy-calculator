import { test } from "node:test";
import assert from "node:assert/strict";
import { addEntry, makeEntry, removeEntry, summarize } from "./offer-list.js";
import { calculateOffer } from "./money.js";

const priced = (key, referenceCents) => ({
  key,
  label: `Card ${key}`,
  condition: "Near Mint",
  referenceCents,
  offerCents: calculateOffer(referenceCents, 6000).offerCents,
  sourceUpdatedAt: "2026-10-10T00:00:00.000Z",
});

test("list total is the sum of each card's own 60% offer, in whole cents", () => {
  let list = [];
  list = addEntry(list, priced("a", 1499)); // $8.99
  list = addEntry(list, priced("b", 20000)); // $120.00
  list = addEntry(list, priced("c", 1)); // $0.01
  assert.deepEqual(summarize(list), {
    count: 3,
    priced: 3,
    unpriced: 0,
    offerCents: 899 + 12000 + 1,
    referenceCents: 21500,
  });
});

test("cards without an online estimate are listed but never priced or totalled", () => {
  let list = addEntry([], priced("a", 1000));
  list = addEntry(list, {
    key: "b",
    label: "Stale card",
    condition: "Near Mint",
    unavailable: "price out of date",
  });
  const summary = summarize(list);
  assert.equal(summary.count, 2);
  assert.equal(summary.unpriced, 1);
  assert.equal(summary.offerCents, 600);
  assert.equal(list[1].offerCents, null);
  assert.equal(list[1].referenceCents, null);
  assert.equal(list[1].unavailable, "price out of date");
});

test("a half-priced or invalid entry is treated as unpriced, never guessed", () => {
  for (const bad of [
    { offerCents: 600 },
    { offerCents: 600, referenceCents: -1 },
    { offerCents: 1.5, referenceCents: 3 },
    { offerCents: "600", referenceCents: "1000" },
  ]) {
    const entry = makeEntry({ key: "x", label: "X", condition: "NM", ...bad });
    assert.equal(entry.offerCents, null, JSON.stringify(bad));
    assert.equal(entry.unavailable, "No estimate");
  }
});

test("removing a card removes only that card; empty list totals zero", () => {
  let list = addEntry(addEntry([], priced("a", 1000)), priced("b", 1000));
  list = removeEntry(list, "a");
  assert.deepEqual(
    list.map((item) => item.key),
    ["b"],
  );
  assert.deepEqual(summarize([]), {
    count: 0,
    priced: 0,
    unpriced: 0,
    offerCents: 0,
    referenceCents: 0,
  });
});

test("an unsafe total throws instead of rounding", () => {
  const huge = makeEntry({
    key: "h",
    label: "H",
    condition: "NM",
    offerCents: Number.MAX_SAFE_INTEGER,
    referenceCents: Number.MAX_SAFE_INTEGER,
  });
  assert.throws(() => summarize([huge, huge]), /too large/);
});
