import {
  calculateOffer,
  formatMoney,
  formatRate,
  parsePercentageToBasisPoints,
} from "./lib/money.js";
import { findPricing, searchCards } from "./lib/lookup.js";

const [config, dataset] = await Promise.all([
  fetch("./data/config.json").then((response) => response.json()),
  fetch("./data/sample-pricing.json").then((response) => response.json()),
]);
const state = { card: null, condition: null };
const searchInput = document.querySelector("#card-search");
const searchResults = document.querySelector("#search-results");
const searchMessage = document.querySelector("#search-message");
const conditionList = document.querySelector("#condition-list");
const calculateButton = document.querySelector("#calculate-button");
const resultEmpty = document.querySelector("#result-empty");
const resultReady = document.querySelector("#result-ready");
const resultUnavailable = document.querySelector("#result-unavailable");

document.querySelectorAll("[data-client-name]").forEach((element) => {
  element.textContent = config.business_name;
});
document.querySelector("[data-disclaimer]").textContent = config.disclaimer;
document.querySelector("[data-data-status]").textContent = config.data_status;
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
    button.innerHTML = `<span><strong>${card.name}</strong><small>${card.set_name}</small></span><span>${card.card_number}</span>`;
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
  const pricing = findPricing(dataset.pricing, {
    cardId: state.card.id,
    conditionCode: state.condition.code,
  });
  resultEmpty.hidden = true;
  resultReady.hidden = Boolean(!pricing);
  resultUnavailable.hidden = Boolean(pricing);
  if (!pricing) return;
  const result = calculateOffer(
    pricing.reference_cents,
    parsePercentageToBasisPoints(config.buy_rate),
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
