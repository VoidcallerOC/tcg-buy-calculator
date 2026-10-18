import { parseMoneyToCents, parsePercentageToBasisPoints } from "./money.js";

// Value-based buy-rate floors. A tier raises the buy rate for cards whose
// market reference is at or above `min_market_value`; it never lowers it.
// Tiers are only defined for raw cards: no graded/slab data exists yet, so
// `applies_to` must be "raw" and graded cards are never inferred.
export const TIER_APPLIES_TO = "raw";

export function parseBuyRateTiers(tiers = []) {
  if (!Array.isArray(tiers)) throw new Error("buy_rate_tiers must be a list.");
  return tiers
    .map((tier) => {
      if ((tier?.applies_to ?? TIER_APPLIES_TO) !== TIER_APPLIES_TO)
        throw new Error('buy_rate_tiers: only applies_to "raw" is supported.');
      return {
        minReferenceCents: parseMoneyToCents(tier.min_market_value),
        rateBasisPoints: parsePercentageToBasisPoints(tier.buy_rate),
      };
    })
    .sort((a, b) => a.minReferenceCents - b.minReferenceCents);
}

/**
 * Buy rate (basis points) for a raw card. Selected on the market reference
 * (before any condition multiplier), inclusive threshold, never below base.
 */
export function resolveBuyRateBasisPoints({
  marketReferenceCents,
  baseRateBasisPoints,
  tiers = [],
}) {
  if (!Number.isSafeInteger(marketReferenceCents) || marketReferenceCents < 0)
    throw new Error("Market reference is required to select a buy rate.");
  let rate = baseRateBasisPoints;
  for (const tier of tiers)
    if (marketReferenceCents >= tier.minReferenceCents)
      rate = Math.max(rate, tier.rateBasisPoints);
  return rate;
}
