// Server-side record of the live pricing provider's authorization. The card
// API refuses to serve pricing unless this evaluates as authorized; an API key
// on its own is never treated as permission. `data/config.json` mirrors these
// statuses for display and is checked against this record by the test suite.

export const JUSTTCG_AUTHORIZATION = {
  provider: "JustTCG",
  plan: "Starter Plan",
  plan_verified_at: "2026-10-10",
  plan_evidence:
    'JustTCG /v1/games response _metadata.apiPlan = "Starter Plan" for the production key; Starter is a paid tier ($19/mo) that JustTCG lists with a commercial license.',
  terms_urls: [
    "https://justtcg.com/docs/commercial-use",
    "https://justtcg.com/pricing",
    "https://justtcg.com/terms",
  ],
  terms_checked_at: "2026-10-10",
  commercial_use_status: "AUTHORIZED",
  derived_pricing_status: "AUTHORIZED",
  attribution_status: "NOT_REQUIRED",
  restrictions: [
    "Do not proxy or re-expose JustTCG endpoints for third-party querying.",
    "Do not redistribute, resell, or export raw provider data.",
    "A JustTCG price is a market observation, not a quote or offer.",
  ],
  condition_policy_status: "APPROVED",
  condition_policy_version: "1.0",
};

export function evaluatePricingAuthorization(record = JUSTTCG_AUTHORIZATION) {
  const blockers = [];
  if (record?.commercial_use_status !== "AUTHORIZED")
    blockers.push("Provider commercial use is not authorized.");
  if (record?.derived_pricing_status !== "AUTHORIZED")
    blockers.push("Derived pricing display is not authorized.");
  if (!["NOT_REQUIRED", "IMPLEMENTED"].includes(record?.attribution_status))
    blockers.push("Provider attribution requirements are unresolved.");
  if (!record?.plan || !record?.plan_verified_at)
    blockers.push("Paid provider plan has not been verified.");
  if (record?.condition_policy_status !== "APPROVED")
    blockers.push("Condition policy is not approved.");
  return { authorized: blockers.length === 0, blockers };
}
