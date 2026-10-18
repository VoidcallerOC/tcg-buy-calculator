import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBuyRateTiers,
  resolveBuyRateBasisPoints,
} from "./buy-rate-tiers.js";
import { calculateEstimatedOffer } from "./condition-policy.js";
import { calculateOffer, formatRate, parseMoneyToCents } from "./money.js";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("data/config.json", "utf8"));
const tiers = parseBuyRateTiers(config.buy_rate_tiers);
const base = 6000;
const policy = {
  NM: {
    status: "APPROVED",
    enabled: true,
    multiplier_basis_points: 10000,
    policy_version: "1.0",
  },
  LP: {
    status: "APPROVED",
    enabled: true,
    multiplier_basis_points: 9000,
    policy_version: "1.0",
  },
};
const rate = (price) =>
  resolveBuyRateBasisPoints({
    marketReferenceCents: parseMoneyToCents(price),
    baseRateBasisPoints: base,
    tiers,
  });

test("raw tier boundaries: threshold is inclusive at $1,000", () => {
  assert.equal(rate("999.99"), 6000);
  assert.equal(rate("1000.00"), 7000);
  assert.equal(rate("1000.01"), 7000);
  assert.equal(rate("1999.99"), 7000);
  assert.equal(rate("2000.00"), 7000);
  assert.equal(rate("5.00"), 6000);
});

test("tier never lowers a higher client base rate", () => {
  assert.equal(
    resolveBuyRateBasisPoints({
      marketReferenceCents: 200000,
      baseRateBasisPoints: 7500,
      tiers,
    }),
    7500,
  );
});

test("no tiers configured keeps existing behavior", () => {
  assert.equal(
    resolveBuyRateBasisPoints({
      marketReferenceCents: 500000,
      baseRateBasisPoints: base,
      tiers: parseBuyRateTiers(undefined),
    }),
    6000,
  );
});

test("missing or invalid market price throws instead of defaulting", () => {
  for (const bad of [undefined, null, NaN, -1, 1.5])
    assert.throws(
      () =>
        resolveBuyRateBasisPoints({
          marketReferenceCents: bad,
          baseRateBasisPoints: base,
          tiers,
        }),
      /Market reference/,
    );
});

test("tier config rejects graded scope and bad values", () => {
  assert.throws(
    () =>
      parseBuyRateTiers([
        { applies_to: "graded", min_market_value: "2000", buy_rate: "70%" },
      ]),
    /raw/,
  );
  assert.throws(
    () => parseBuyRateTiers([{ min_market_value: "x", buy_rate: "70%" }]),
    /Price/,
  );
  assert.throws(
    () => parseBuyRateTiers([{ min_market_value: "1000", buy_rate: "101%" }]),
    /Buy rate/,
  );
});

test("offer applies the tier rate once and displayed rate matches", () => {
  const reference = parseMoneyToCents("1000.00");
  const result = calculateOffer(reference, rate("1000.00"));
  assert.equal(result.offerCents, 70000);
  assert.equal(formatRate(result.rateBasisPoints), "70%");
  assert.deepEqual(calculateOffer(reference, rate("1000.00")), result);
  const below = calculateOffer(99999, rate("999.99"));
  assert.equal(below.offerCents, 59999);
  assert.equal(formatRate(below.rateBasisPoints), "60%");
});

test("condition multiplier and tier compose once; tier chosen on market value", () => {
  const nm = calculateEstimatedOffer({
    marketReferenceCents: 100000,
    conditionCode: "NM",
    shopBuyRate: base,
    buyRateTiers: tiers,
    policy,
  });
  assert.equal(nm.shopBuyRateBasisPoints, 7000);
  assert.equal(nm.estimatedOfferCents, 70000);
  const lp = calculateEstimatedOffer({
    marketReferenceCents: 100000,
    conditionCode: "LP",
    shopBuyRate: base,
    buyRateTiers: tiers,
    policy,
  });
  assert.equal(lp.conditionAdjustedReferenceCents, 90000);
  assert.equal(lp.shopBuyRateBasisPoints, 7000); // 90% of $1,000 stays in the $1,000 tier
  assert.equal(lp.estimatedOfferCents, 63000);
  const low = calculateEstimatedOffer({
    marketReferenceCents: 99999,
    conditionCode: "NM",
    shopBuyRate: base,
    policy,
  });
  assert.equal(low.shopBuyRateBasisPoints, 6000);
});

test("shipped config keeps base rate and defines only the raw tier", () => {
  assert.equal(config.buy_rate, "60%");
  assert.equal(tiers.length, 1);
});
