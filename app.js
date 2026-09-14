import {
  calculateOffer,
  formatMoney,
  formatRate,
  parsePercentageToBasisPoints,
} from "./lib/money.js";
import { findPricing, searchCards } from "./lib/lookup.js";
import { evaluateProductionGate } from "./lib/production-gate.js";

const config = await fetch("./data/config.json").then((response) => {
  if (!response.ok) throw new Error("Client configuration unavailable.");
  return response.json();
});

async function loadDataset() {
  if (config.pricing_mode !== "production") {
    const dataset = await fetch("./data/sample-pricing.json").then((response) =>
      response.json(),
    );
    return { ...dataset, data_status: config.data_status, stale: false };
  }
  const gate = evaluateProductionGate({
    commercialUseStatus: config.tcgcsv_commercial_use_status,
    derivedPricingStatus: config.tcgcsv_derived_pricing_status,
    attributionStatus: config.tcgcsv_attribution_status,
    attributionSatisfied: config.tcgcsv_attribution_implemented === true,
    conditionPolicyStatus: config.condition_policy_status,
    supabaseConfigured: Boolean(
      config.pricing_backend_url && config.pricing_backend_publishable_key,
    ),
  });
  if (gate.status === "BLOCKED")
    throw new Error(
      "Production pricing provider requires commercial-use confirmation.",
    );
  const base = config.pricing_backend_url;
  const headers = {
    apikey: config.pricing_backend_publishable_key,
    Authorization: `Bearer ${config.pricing_backend_publishable_key}`,
  };
  const query = (resource) =>
    fetch(`${base}/rest/v1/${resource}`, { headers }).then(async (response) => {
      if (!response.ok)
        throw new Error("Pricing service is currently unavailable.");
      return response.json();
    });
  const [client, conditions, cards, pricing] = await Promise.all([
    query(
      `tcg_clients?id=eq.${encodeURIComponent(config.client_id)}&active=eq.true&select=*`,
    ),
    query("tcg_conditions?select=code,name,sort_order&order=sort_order"),
    query(
      "tcg_cards?active=eq.true&select=id,name,card_number,set_code,set_name",
    ),
    query(
      `tcg_pricing?client_id=eq.${encodeURIComponent(config.client_id)}&active=eq.true&select=card_id,condition_code,reference_cents,currency,source_name,source_updated_at,active`,
    ),
  ]);
  if (!client[0]) throw new Error("Client configuration is not published.");
  const latest = pricing.reduce(
    (value, record) =>
      record.source_updated_at > value ? record.source_updated_at : value,
    "",
  );
  const ageDays = latest
    ? Math.floor((Date.now() - Date.parse(`${latest}T00:00:00Z`)) / 86400000)
    : Infinity;
  const stale = ageDays > Number(config.stale_threshold_days ?? 7);
  return {
    conditions,
    cards,
    pricing,
    data_status: stale
      ? `REFERENCE PRICING IS STALE — last updated ${latest || "unknown"}`
      : `REFERENCE PRICING UPDATED ${latest}`,
    source_updated_at: latest,
    stale,
    ageDays,
    client: client[0],
  };
}

let dataset;
try {
  dataset = await loadDataset();
} catch (error) {
  document.querySelector("[data-data-status]").textContent = error.message;
  document.querySelector("[data-pricing-status]").textContent =
    "Pricing is unavailable. Please try again later or visit the shop.";
  throw error;
}

const state = { card: null, condition: null };
const searchInput = document.querySelector("#card-search");
const searchResults = document.querySelector("#search-results");
const searchMessage = document.querySelector("#search-message");
const conditionList = document.querySelector("#condition-list");
const calculateButton = document.querySelector("#calculate-button");
const resultEmpty = document.querySelector("#result-empty");
const resultReady = document.querySelector("#result-ready");
const resultUnavailable = document.querySelector("#result-unavailable");
const productionBlocked =
  config.pricing_mode === "production" &&
  dataset.stale &&
  !config.allow_stale_pricing;

for (const element of document.querySelectorAll("[data-client-name]"))
  element.textContent = config.business_name;
document.querySelector("[data-disclaimer]").textContent = config.disclaimer;
document.querySelector("[data-data-status]").textContent =
  config.pricing_mode === "sample" ? config.data_status : dataset.data_status;
document.querySelector("[data-pricing-status]").textContent = productionBlocked
  ? "Reference pricing is stale. Final offers require in-store verification."
  : config.pricing_mode === "sample"
    ? "Development sample data is shown for demonstration only."
    : `Reference pricing updated ${dataset.source_updated_at}.`;
document.documentElement.style.setProperty("--brick", config.primary_color);
document.documentElement.style.setProperty("--yellow", config.secondary_color);

dataset.conditions.forEach((condition) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "condition-option";
  button.textContent = condition.name;
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    state.condition = condition;
    document.querySelectorAll(".condition-option").forEach((option) => {
      option.classList.remove("is-selected");
      option.setAttribute("aria-pressed", "false");
    });
    button.classList.add("is-selected");
    button.setAttribute("aria-pressed", "true");
    calculateButton.disabled = !state.card;
    renderResult();
  });
  conditionList.append(button);
});

function renderSearchResults() {
  const query = searchInput.value;
  searchResults.replaceChildren();
  if (!query.trim()) {
    searchMessage.textContent = "Start typing to see matching cards.";
    return;
  }
  const matches = searchCards(dataset.cards, query).slice(0, 8);
  if (!matches.length) {
    searchMessage.textContent =
      "No matching cards found. Try a card number or set code.";
    return;
  }
  searchMessage.textContent = `${matches.length} matching card${matches.length === 1 ? "" : "s"}. Select one to continue.`;
  matches.forEach((card) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    const details = document.createElement("span");
    const name = document.createElement("strong");
    const set = document.createElement("small");
    const number = document.createElement("span");
    name.textContent = card.name;
    set.textContent = card.set_name;
    number.textContent = card.card_number;
    details.append(name, set);
    button.append(details, number);
    button.addEventListener("click", () => {
      state.card = card;
      searchInput.value = `${card.name} · ${card.card_number}`;
      searchResults.replaceChildren();
      searchMessage.textContent = "Card selected. Choose a condition below.";
      calculateButton.disabled = !state.condition;
      renderResult();
    });
    searchResults.append(button);
  });
}

function renderResult() {
  if (!state.card || !state.condition) return;
  if (productionBlocked) {
    resultEmpty.hidden = true;
    resultReady.hidden = true;
    resultUnavailable.hidden = false;
    resultUnavailable.querySelector("strong").textContent =
      "Pricing unavailable because the reference dataset is stale.";
    resultUnavailable.querySelector("p").textContent =
      "Final offer requires in-store verification.";
    return;
  }
  let pricing;
  try {
    pricing = findPricing(dataset.pricing, {
      cardId: state.card.id,
      conditionCode: state.condition.code,
    });
  } catch (error) {
    resultEmpty.hidden = true;
    resultReady.hidden = true;
    resultUnavailable.hidden = false;
    resultUnavailable.querySelector("strong").textContent =
      "Online estimate unavailable because pricing data is ambiguous.";
    resultUnavailable.querySelector("p").textContent = error.message;
    return;
  }
  resultEmpty.hidden = true;
  resultReady.hidden = Boolean(!pricing);
  resultUnavailable.hidden = Boolean(pricing);
  if (!pricing) {
    resultUnavailable.querySelector("strong").textContent =
      "Online estimate unavailable: pricing unavailable for this condition.";
    resultUnavailable.querySelector("p").textContent =
      "We never invent a price or substitute another condition.";
    return;
  }
  const buyRate =
    config.buy_rate ?? formatRate(dataset.client.buy_rate_basis_points);
  const result = calculateOffer(
    pricing.reference_cents,
    parsePercentageToBasisPoints(buyRate),
  );
  document.querySelector("#offer-value").textContent = formatMoney(
    result.offerCents,
    config.currency,
  );
  document.querySelector("#reference-value").textContent = formatMoney(
    result.referenceCents,
    config.currency,
  );
  document.querySelector("#rate-value").textContent = formatRate(
    result.rateBasisPoints,
  );
  document.querySelector("#result-card-label").textContent =
    `${state.card.name} · ${state.condition.name}`;
}

searchInput.addEventListener("input", renderSearchResults);
calculateButton.addEventListener("click", renderResult);
