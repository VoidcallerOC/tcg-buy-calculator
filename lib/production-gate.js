export const COMMERCIAL_USE_STATUSES = ["AUTHORIZED", "UNCLEAR", "DENIED"];
export const ATTRIBUTION_STATUSES = ["REQUIRED", "NOT_REQUIRED", "UNCLEAR"];

export function evaluateProductionGate({
  commercialUseStatus = "UNCLEAR",
  derivedPricingStatus = "UNCLEAR",
  attributionStatus = "UNCLEAR",
  attributionSatisfied = false,
  conditionPolicyStatus = "UNCONFIGURED",
  providerReachable = false,
  categoriesDiscovered = false,
  catalogValidated = false,
  pricingValidated = false,
  supabaseConfigured = false,
  adminAuthorized = false,
} = {}) {
  const checks = [
    {
      key: "commercialUseConfirmed",
      label: "TCGCSV commercial use confirmed",
      passed: commercialUseStatus === "AUTHORIZED",
    },
    {
      key: "derivedPricingAuthorized",
      label: "Derived pricing redistribution authorized",
      passed: derivedPricingStatus === "AUTHORIZED",
    },
    {
      key: "attributionSatisfied",
      label: "Attribution requirements satisfied",
      passed:
        attributionStatus === "NOT_REQUIRED" ||
        (attributionStatus === "REQUIRED" && attributionSatisfied),
    },
    {
      key: "conditionPolicyApproved",
      label: "Condition policy approved",
      passed: conditionPolicyStatus === "APPROVED",
    },
    {
      key: "providerReachable",
      label: "Provider reachable",
      passed: providerReachable,
    },
    {
      key: "categoriesDiscovered",
      label: "Categories discovered",
      passed: categoriesDiscovered,
    },
    {
      key: "catalogValidated",
      label: "Catalog validated",
      passed: catalogValidated,
    },
    {
      key: "pricingValidated",
      label: "Pricing validated",
      passed: pricingValidated,
    },
    {
      key: "supabaseConfigured",
      label: "Supabase production configured",
      passed: supabaseConfigured,
    },
    {
      key: "adminAuthorized",
      label: "Admin authorized",
      passed: adminAuthorized,
    },
  ];
  const failed = checks.filter((check) => !check.passed);
  return {
    status: failed.length ? "BLOCKED" : "READY",
    production_status: failed.length ? "BLOCKED" : "READY",
    checks,
    blockers: failed.map(({ label }) => label),
  };
}

export function getOperationalState({
  gate,
  pricingPublished = false,
  inputRequired = true,
} = {}) {
  if (gate?.status === "BLOCKED") return "RED — BLOCKED";
  if (!pricingPublished || inputRequired)
    return "YELLOW — READY BUT OPERATIONAL INPUT REQUIRED";
  return "GREEN — LIVE";
}
