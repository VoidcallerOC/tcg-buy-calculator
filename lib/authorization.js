export const AUTHORIZATION_STATUSES = ["AUTHORIZED", "UNCLEAR", "DENIED"];
export const ATTRIBUTION_STATUSES = ["REQUIRED", "NOT_REQUIRED", "UNCLEAR"];

export function validateAuthorizationEvidence(evidence = {}) {
  const errors = [];
  if (!evidence.provider) errors.push("Provider is required.");
  if (!evidence.source_url) errors.push("Source URL is required.");
  if (!evidence.response_url) errors.push("Response or issue URL is required.");
  if (!evidence.authorization_date)
    errors.push("Authorization date is required.");
  if (!evidence.maintainer_name)
    errors.push("Maintainer identity is required.");
  if (!evidence.permission_scope)
    errors.push("Exact permission scope is required.");
  if (!evidence.evidence_text)
    errors.push("Original evidence text is required.");
  if (evidence.commercial_use_status !== "AUTHORIZED")
    errors.push("Commercial-use authorization is not confirmed.");
  if (evidence.derived_pricing_status !== "AUTHORIZED")
    errors.push("Derived-pricing authorization is not confirmed.");
  if (!["REQUIRED", "NOT_REQUIRED"].includes(evidence.attribution_status))
    errors.push("Attribution requirements are unresolved.");
  return errors;
}

export function overallAuthorizationStatus(evidence = {}) {
  if (
    evidence.commercial_use_status === "DENIED" ||
    evidence.derived_pricing_status === "DENIED"
  )
    return "DENIED";
  return validateAuthorizationEvidence(evidence).length
    ? "PENDING"
    : "AUTHORIZED";
}
