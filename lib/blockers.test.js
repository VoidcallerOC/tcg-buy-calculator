import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateEstimatedOffer,
  getConditionPolicyStatus,
  createUnconfiguredConditionPolicy,
} from "./condition-policy.js";
import { classifyCategory, cardGameCategories } from "./category-classifier.js";
import {
  evaluateProductionGate,
  getOperationalState,
} from "./production-gate.js";
import {
  overallAuthorizationStatus,
  validateAuthorizationEvidence,
} from "./authorization.js";

test("unconfigured condition policy cannot calculate an offer", () => {
  const policy = createUnconfiguredConditionPolicy();
  assert.equal(getConditionPolicyStatus(policy), "UNCONFIGURED");
  assert.throws(
    () =>
      calculateEstimatedOffer({
        marketReferenceCents: 10000,
        conditionCode: "LP",
        shopBuyRate: 6000,
        policy,
      }),
    /not approved/,
  );
});

test("approved condition policy applies market adjustment then shop buy rate in cents", () => {
  const policy = Object.fromEntries(
    ["NM", "LP", "MP", "HP", "DMG"].map((code) => [
      code,
      {
        status: "APPROVED",
        enabled: true,
        multiplier_basis_points: 10000,
        policy_version: "1.0",
      },
    ]),
  );
  for (const conditionCode of ["NM", "LP", "MP", "HP", "DMG"]) {
    assert.equal(
      calculateEstimatedOffer({
        marketReferenceCents: 10000,
        conditionCode,
        shopBuyRate: 6000,
        policy,
      }).conditionAdjustedReferenceCents,
      10000,
    );
    assert.equal(
      calculateEstimatedOffer({
        marketReferenceCents: 1999,
        conditionCode,
        shopBuyRate: 6000,
        policy,
      }).estimatedOfferCents,
      1199,
    );
  }
  const lpPolicy = {
    LP: {
      status: "APPROVED",
      enabled: true,
      multiplier_basis_points: 9000,
      policy_version: "test",
    },
  };
  assert.deepEqual(
    calculateEstimatedOffer({
      marketReferenceCents: 10000,
      conditionCode: "LP",
      shopBuyRate: 6000,
      policy: lpPolicy,
    }),
    {
      marketReferenceCents: 10000,
      conditionMultiplierBasisPoints: 9000,
      conditionAdjustedReferenceCents: 9000,
      shopBuyRateBasisPoints: 6000,
      estimatedOfferCents: 5400,
      policyVersion: "test",
    },
  );
  assert.equal(
    calculateEstimatedOffer({
      marketReferenceCents: 1,
      conditionCode: "LP",
      shopBuyRate: 5000,
      policy,
    }).estimatedOfferCents,
    1,
  );
});

test("category classification filters supplies and keeps card-game categories", () => {
  assert.equal(classifyCategory({ name: "Magic" }), "CARD_GAME");
  assert.equal(classifyCategory({ name: "Card Sleeves" }), "SUPPLIES");
  assert.equal(
    cardGameCategories([{ name: "Magic" }, { name: "Boardgames" }]).length,
    1,
  );
});

test("production gate blocks unconfirmed legal and policy inputs", () => {
  const gate = evaluateProductionGate({
    commercialUseStatus: "UNCLEAR",
    conditionPolicyStatus: "UNCONFIGURED",
    supabaseConfigured: true,
  });
  assert.equal(gate.status, "BLOCKED");
  assert.match(gate.blockers.join(";"), /commercial|condition/i);
  assert.equal(getOperationalState({ gate }), "RED — BLOCKED");
});

test("production gate blocks unresolved derived-pricing authorization", () => {
  const gate = evaluateProductionGate({
    commercialUseStatus: "AUTHORIZED",
    derivedPricingStatus: "UNCLEAR",
    attributionStatus: "REQUIRED",
    attributionSatisfied: true,
    conditionPolicyStatus: "APPROVED",
    providerReachable: true,
    categoriesDiscovered: true,
    catalogValidated: true,
    pricingValidated: true,
    supabaseConfigured: true,
    adminAuthorized: true,
  });
  assert.equal(gate.status, "BLOCKED");
  assert.match(gate.blockers.join(";"), /derived pricing/i);
});

test("production gate can reach live only after every check passes", () => {
  const gate = evaluateProductionGate({
    commercialUseStatus: "AUTHORIZED",
    derivedPricingStatus: "AUTHORIZED",
    attributionStatus: "REQUIRED",
    attributionSatisfied: true,
    conditionPolicyStatus: "APPROVED",
    providerReachable: true,
    categoriesDiscovered: true,
    catalogValidated: true,
    pricingValidated: true,
    supabaseConfigured: true,
    adminAuthorized: true,
  });
  assert.equal(gate.status, "READY");
  assert.equal(
    getOperationalState({ gate, pricingPublished: true, inputRequired: false }),
    "GREEN — LIVE",
  );
});

test("authorization evidence remains pending until complete and becomes authorized only with exact scope", () => {
  assert.equal(overallAuthorizationStatus({}), "PENDING");
  assert.equal(
    overallAuthorizationStatus({
      commercial_use_status: "DENIED",
      derived_pricing_status: "AUTHORIZED",
    }),
    "DENIED",
  );
  const evidence = {
    provider: "TCGCSV",
    source_url: "https://tcgcsv.com/docs",
    response_url: "https://github.com/CptSpaceToaster/tcgcsv/issues/1",
    authorization_date: "2026-09-14",
    maintainer_name: "CptSpaceToaster",
    permission_scope:
      "Commercial use and serving derived market references to calculator users.",
    evidence_text: "Written authorization response.",
    commercial_use_status: "AUTHORIZED",
    derived_pricing_status: "AUTHORIZED",
    attribution_status: "NOT_REQUIRED",
  };
  assert.deepEqual(validateAuthorizationEvidence(evidence), []);
  assert.equal(overallAuthorizationStatus(evidence), "AUTHORIZED");
});
