import { parsePricingCsv } from "../lib/csv-import.js";

const config = await fetch("../data/config.json").then((response) =>
  response.json(),
);
const base = config.pricing_backend_url;
const publishableKey = config.pricing_backend_publishable_key;
const fileInput = document.querySelector("#csv-file");
const loginPanel = document.querySelector("#login-panel");
const importPanel = document.querySelector("#import-panel");
const loginMessage = document.querySelector("#login-message");
const sessionMessage = document.querySelector("#session-message");
const message = document.querySelector("#import-message");
const summary = document.querySelector("#import-summary");
const errors = document.querySelector("#import-errors");
const publishButton = document.querySelector("#publish-button");
const providerStatus = document.querySelector("#provider-status");
const policyPanel = document.querySelector("#policy-panel");
const policyStatus = document.querySelector("#condition-policy-status");
const readinessStatus = document.querySelector("#readiness-status");
const softwareReadiness = document.querySelector("#software-readiness");
const businessPolicyReadiness = document.querySelector(
  "#business-policy-readiness",
);
const externalAuthorizationReadiness = document.querySelector(
  "#external-authorization-readiness",
);
const productionActivationReadiness = document.querySelector(
  "#production-activation-readiness",
);
const authorizationEvidence = document.querySelector("#authorization-evidence");
let session = null;
let previewRows = null;
let conditions = [];

const publicHeaders = { apikey: publishableKey };
async function api(resource, options = {}) {
  const response = await fetch(`${base}${resource}`, {
    ...options,
    headers: {
      ...publicHeaders,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(body || `Request failed (${response.status}).`);
  return body ? JSON.parse(body) : null;
}

function addSummaryLine(label, value) {
  const element = document.createElement("span");
  element.textContent = `${label} ${value}`;
  summary.append(element);
}

function renderReadiness({ client, policies, compliance }) {
  const policyApproved =
    policies.length >= 5 &&
    policies.every(
      (policy) =>
        policy.status === "APPROVED" &&
        policy.enabled &&
        Number.isInteger(policy.multiplier_basis_points),
    );
  const commercial = compliance.commercial_use_status || "UNCLEAR";
  const derived = compliance.derived_pricing_status || "UNCLEAR";
  const attribution = compliance.attribution_status || "UNCLEAR";
  const externalAuthorized =
    commercial === "AUTHORIZED" &&
    derived === "AUTHORIZED" &&
    (attribution === "NOT_REQUIRED" ||
      (attribution === "REQUIRED" && compliance.attribution_implemented));
  const denied = commercial === "DENIED" || derived === "DENIED";
  const policyVersion = policies.find(
    (policy) => policy.policy_version,
  )?.policy_version;
  softwareReadiness.textContent = "GREEN — SOFTWARE COMPLETE";
  businessPolicyReadiness.textContent = policyApproved
    ? `GREEN — APPROVED (v${policyVersion || "backend"})`
    : "RED — CONDITION POLICY INCOMPLETE";
  externalAuthorizationReadiness.textContent = denied
    ? "RED — AUTHORIZATION DENIED"
    : externalAuthorized
      ? "GREEN — AUTHORIZED"
      : "PENDING — EXTERNAL AUTHORIZATION REQUIRED";
  productionActivationReadiness.textContent =
    externalAuthorized && policyApproved
      ? "READY — SERVER-SIDE GATE STILL REQUIRED"
      : denied
        ? "RED — PRODUCTION BLOCKED"
        : "BLOCKED — EXTERNAL AUTHORIZATION REQUIRED";
  authorizationEvidence.textContent = [
    `Commercial use: ${commercial}`,
    `Derived pricing: ${derived}`,
    `Attribution: ${attribution}`,
    `Provider: ${compliance.provider || "TCGCSV"}`,
    compliance.authorization_source
      ? `Source: ${compliance.authorization_source}`
      : "Evidence source: not supplied",
    compliance.authorization_date
      ? `Date: ${compliance.authorization_date}`
      : "Authorization date: not supplied",
    compliance.permission_scope
      ? `Scope: ${compliance.permission_scope}`
      : "Scope: not supplied",
  ].join(" · ");
  readinessStatus.textContent = `${client.business_name}. Buy rate: ${(client.buy_rate_basis_points / 100).toFixed(0)}%. Provider: ${compliance.provider || "TCGCSV"}.`;
  policyStatus.textContent = `Condition policy: ${policyApproved ? "APPROVED" : "UNCONFIGURED"}. ${policies.map((policy) => `${policy.display_name}: ${policy.multiplier_basis_points == null ? "—" : `${policy.multiplier_basis_points / 100}%`} market reference`).join(" · ")}`;
}

async function signIn() {
  try {
    const email = document.querySelector("#admin-email").value.trim();
    const password = document.querySelector("#admin-password").value;
    if (!email || !password)
      throw new Error("Email and password are required.");
    const response = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { ...publicHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error_description || body.msg || "Sign-in failed.");
    session = body;
    const [clientRows, conditionRows, policyRows, complianceRows] =
      await Promise.all([
        api(
          `/rest/v1/tcg_clients?id=eq.${encodeURIComponent(config.client_id)}&select=*`,
        ),
        api("/rest/v1/tcg_conditions?select=code,name&order=sort_order"),
        api(
          `/rest/v1/tcg_condition_policies?client_id=eq.${encodeURIComponent(config.client_id)}&select=*`,
        ),
        api(
          `/rest/v1/tcg_source_compliance?client_id=eq.${encodeURIComponent(config.client_id)}&select=*`,
        ),
      ]);
    const client = clientRows[0];
    const compliance = complianceRows[0];
    if (!client || !compliance)
      throw new Error("Production readiness configuration is incomplete.");
    conditions = conditionRows;
    renderReadiness({ client, policies: policyRows, compliance });
    const statusResponse = await fetch(`${base}/functions/v1/justtcg-sync`, {
      headers: {
        ...publicHeaders,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const status = await statusResponse.json();
    providerStatus.textContent = status.configured
      ? `JustTCG provider: ${status.status}. Paid-plan authorization remains ${status.authorization_status || "pending"}.`
      : "JustTCG provider is not configured. Production synchronization is disabled until the server-side key and paid plan are verified.";
    policyPanel.hidden = false;
    loginPanel.hidden = true;
    importPanel.hidden = false;
    sessionMessage.textContent = `Signed in as ${email}. Upload a CSV to preview it before server-side publishing.`;
  } catch (error) {
    loginMessage.textContent = error.message;
  }
}

document.querySelector("#login-button").addEventListener("click", signIn);
fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files;
  if (!file) return;
  try {
    const result = parsePricingCsv(await file.text(), conditions);
    previewRows = result.rows;
    message.textContent = result.counts.errors
      ? "Fix the errors below before publishing."
      : "Validation passed. Review the counts, then explicitly publish.";
    summary.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = "Preview counts";
    summary.append(heading);
    addSummaryLine("Total rows", result.counts.total);
    addSummaryLine("Valid rows", result.counts.valid);
    addSummaryLine("Errors", result.counts.errors);
    summary.hidden = false;
    errors.replaceChildren();
    result.errors.forEach((error) => {
      const line = document.createElement("div");
      line.textContent = `Row ${error.row}: ${error.message}`;
      errors.append(line);
    });
    errors.hidden = !result.errors.length;
    publishButton.disabled =
      Boolean(result.errors.length) || !result.rows.length;
  } catch (error) {
    previewRows = null;
    publishButton.disabled = true;
    summary.hidden = true;
    errors.hidden = false;
    errors.textContent = error.message;
    message.textContent =
      "Upload rejected. Existing pricing remains unchanged.";
  }
});

publishButton.addEventListener("click", async () => {
  if (!previewRows || !session) return;
  publishButton.disabled = true;
  message.textContent = "Publishing transactionally on the server…";
  try {
    const result = await api("/rest/v1/rpc/tcg_publish_pricing_import", {
      method: "POST",
      body: JSON.stringify({
        p_client_id: config.client_id,
        p_rows: previewRows,
      }),
    });
    message.textContent = `Published successfully: ${result.updated ?? 0} updated, ${result.imported ?? 0} imported, ${result.unchanged ?? 0} unchanged.`;
  } catch (error) {
    message.textContent = `Publish failed; the transaction was rolled back. ${error.message}`;
    publishButton.disabled = false;
  }
});
