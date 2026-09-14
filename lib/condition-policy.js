import { calculateOffer, parsePercentageToBasisPoints } from "./money.js";

export const CONDITION_CODES = ["NM", "LP", "MP", "HP", "DMG"];
export const POLICY_STATUSES = ["UNCONFIGURED", "DRAFT", "APPROVED"];

export function createUnconfiguredConditionPolicy() {
  return Object.fromEntries(
    CONDITION_CODES.map((code) => [
      code,
      {
        code,
        multiplier_basis_points: null,
        enabled: false,
        display_name: code,
        notes: "Awaiting shop approval.",
        effective_date: null,
        approved_by: null,
        policy_version: null,
        status: "UNCONFIGURED",
      },
    ]),
  );
}

export function validateConditionPolicy(policy = {}) {
  const errors = [];
  for (const code of CONDITION_CODES) {
    const entry = policy[code];
    if (!entry || entry.status === "UNCONFIGURED") continue;
    if (!POLICY_STATUSES.includes(entry.status))
      errors.push(`${code}: invalid policy status.`);
    if (
      !Number.isInteger(entry.multiplier_basis_points) ||
      entry.multiplier_basis_points < 0 ||
      entry.multiplier_basis_points > 10000
    )
      errors.push(
        `${code}: multiplier must be integer basis points from 0 to 10000.`,
      );
    if (
      entry.status === "APPROVED" &&
      (!entry.enabled ||
        !entry.effective_date ||
        !entry.approved_by ||
        !entry.policy_version)
    )
      errors.push(
        `${code}: approved policy requires enabled, effective date, approver, and version.`,
      );
  }
  return errors;
}

export function getConditionPolicyStatus(policy = {}) {
  const entries = CONDITION_CODES.map((code) => policy[code]);
  if (entries.every((entry) => entry?.status === "APPROVED")) return "APPROVED";
  if (entries.some((entry) => entry?.status === "DRAFT")) return "DRAFT";
  return "UNCONFIGURED";
}

export function calculateEstimatedOffer({
  marketReferenceCents,
  conditionCode,
  shopBuyRate,
  policy,
}) {
  const entry = policy?.[conditionCode];
  if (!entry || entry.status !== "APPROVED" || !entry.enabled)
    throw new Error(
      `Condition ${conditionCode} is unavailable because its policy is not approved.`,
    );
  const adjusted = calculateOffer(
    marketReferenceCents,
    entry.multiplier_basis_points,
  );
  const estimated = calculateOffer(adjusted.offerCents, shopBuyRate);
  return {
    marketReferenceCents: adjusted.referenceCents,
    conditionMultiplierBasisPoints: entry.multiplier_basis_points,
    conditionAdjustedReferenceCents: adjusted.offerCents,
    shopBuyRateBasisPoints: estimated.rateBasisPoints,
    estimatedOfferCents: estimated.offerCents,
    policyVersion: entry.policy_version,
  };
}

export function normalizeMultiplier(value) {
  return parsePercentageToBasisPoints(value);
}
