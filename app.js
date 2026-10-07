import {
  calculateOffer,
  formatMoney,
  formatRate,
  parsePercentageToBasisPoints,
} from "./lib/money.js";

const config = await fetch("./data/config.json").then(async (response) => {
  if (!response.ok) throw new Error("Client configuration unavailable.");
  return response.json();
});

const conditions = [
  { name: "Near Mint", code: "NM" },
  { name: "Lightly Played", code: "LP" },
  { name: "Moderately Played", code: "MP" },
  { name: "Heavily Played", code: "HP" },
  { name: "Damaged", code: "DMG" },
];
const state = { card: null, condition: null, request: 0, loading: false };
const searchInput = document.querySelector("#card-search");
const gameSelect = document.querySelector("#game-select");
const searchResults = document.querySelector("#search-results");
const searchMessage = document.querySelector("#search-message");
const conditionList = document.querySelector("#condition-list");
const calculateButton = document.querySelector("#calculate-button");
const resultEmpty = document.querySelector("#result-empty");
const resultReady = document.querySelector("#result-ready");
const resultUnavailable = document.querySelector("#result-unavailable");
const resultPanel = document.querySelector("#result-panel");
const scanButton = document.querySelector("#scan-button");

const gamesResponse = await fetch("/api/games").catch(() => null);
if (gamesResponse?.ok) {
  const gamesBody = await gamesResponse.json().catch(() => ({}));
  const games = Array.isArray(gamesBody.games) ? gamesBody.games : [];
  if (games.length) {
    gameSelect.replaceChildren(
      ...games.map((game) => {
        const option = document.createElement("option");
        option.value = game.provider_game_id ?? game.id;
        option.textContent = game.name ?? option.value;
        return option;
      }),
    );
  }
}

function isPricingUsable(pricing) {
  if (!pricing || !Number.isSafeInteger(pricing.reference_cents)) return false;
  if (config.allow_stale_pricing) return true;
  if (!pricing.source_updated_at) return true;
  const updatedAt = new Date(pricing.source_updated_at).getTime();
  if (!Number.isFinite(updatedAt)) return false;
  const thresholdMs = Number(config.stale_threshold_days ?? 7) * 86400000;
  return Date.now() - updatedAt <= thresholdMs;
}

for (const element of document.querySelectorAll("[data-client-name]"))
  element.textContent = config.business_name;
document.querySelector("[data-disclaimer]").textContent = config.disclaimer;
document.querySelector("[data-data-status]").textContent =
  "Live provider pricing — final offer subject to in-store verification.";
document.querySelector("[data-pricing-status]").textContent =
  "Search results and reference pricing are retrieved live from JustTCG.";
document.documentElement.style.setProperty("--brick", config.primary_color);
document.documentElement.style.setProperty("--yellow", config.secondary_color);

function resetResult() {
  resultEmpty.hidden = false;
  resultReady.hidden = true;
  resultUnavailable.hidden = true;
}

function setUnavailable(title, message) {
  resultEmpty.hidden = true;
  resultReady.hidden = true;
  resultUnavailable.hidden = false;
  resultUnavailable.querySelector("strong").textContent = title;
  resultUnavailable.querySelector("p").textContent = message;
}

function setSearchLoading(loading) {
  state.loading = loading;
  searchInput.setAttribute("aria-busy", String(loading));
  if (loading) searchMessage.textContent = "Searching live card data…";
}

function renderConditions() {
  for (const condition of conditions) {
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
      calculateButton.disabled = !state.card || state.loading;
      resetResult();
    });
    conditionList.append(button);
  }
}

function selectCard(
  card,
  button,
  message = "Card selected. Choose a condition below.",
) {
  state.card = card;
  document.querySelectorAll(".search-result").forEach((option) => {
    option.classList.remove("is-selected");
    option.setAttribute("aria-pressed", "false");
  });
  button?.classList.add("is-selected");
  button?.setAttribute("aria-pressed", "true");
  searchInput.value = `${card.name} · ${card.card_number}`;
  searchMessage.textContent = message;
  calculateButton.disabled = !state.condition;
  resetResult();
}

function renderSearchResults(cards) {
  searchResults.replaceChildren();
  if (!cards.length) {
    searchMessage.textContent =
      "No matching cards found. Try a card number or set code.";
    return;
  }
  searchMessage.textContent = `${cards.length} matching card${cards.length === 1 ? "" : "s"}. Select one to continue.`;
  cards.slice(0, 8).forEach((card) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.setAttribute("aria-pressed", "false");
    const details = document.createElement("span");
    const name = document.createElement("strong");
    const set = document.createElement("small");
    const number = document.createElement("span");
    name.textContent = card.name;
    set.textContent = card.set_name;
    number.textContent = card.card_number;
    details.append(name, set);
    button.append(details, number);
    button.addEventListener("click", () => selectCard(card, button));
    searchResults.append(button);
  });
}

// Shared by manual search and the scanner: live catalog via /api/cards.
async function lookupCards(query, game) {
  const response = await fetch(
    `/api/cards?game=${encodeURIComponent(game)}&q=${encodeURIComponent(query)}`,
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || "Live pricing provider is unavailable.");
  return Array.isArray(body.cards) ? body.cards : [];
}

async function searchCards(query) {
  const requestId = ++state.request;
  setSearchLoading(true);
  try {
    const cards = await lookupCards(query, gameSelect.value);
    if (requestId !== state.request) return;
    renderSearchResults(cards);
  } catch (error) {
    if (requestId !== state.request) return;
    searchResults.replaceChildren();
    searchMessage.textContent = error.message;
  } finally {
    if (requestId === state.request) setSearchLoading(false);
  }
}

// Scanner is an input method only. A confirmed card enters the same selection
// path as a manual search result; calculateOffer / buy rate are unchanged.
function confirmScannedCard(card) {
  if (
    card.game &&
    [...gameSelect.options].some((option) => option.value === card.game) &&
    gameSelect.value !== card.game
  ) {
    gameSelect.value = card.game;
    state.condition = null;
    document.querySelectorAll(".condition-option").forEach((option) => {
      option.classList.remove("is-selected");
      option.setAttribute("aria-pressed", "false");
    });
  }
  state.request += 1;
  renderSearchResults([card]);
  selectCard(
    card,
    searchResults.querySelector(".search-result"),
    "Card confirmed from your scan. Choose a condition below.",
  );
  conditionList.scrollIntoView({ behavior: "smooth", block: "center" });
}

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  try {
    const { openScanner } = await import("./scanner/scanner-ui.js");
    openScanner({
      search: lookupCards,
      selectedGame: () => gameSelect.value,
      isDemo: () => false,
      onConfirm: confirmScannedCard,
      onManual: (query) => {
        if (query) {
          searchInput.value = query;
          searchInput.dispatchEvent(new Event("input"));
        }
        searchInput.focus();
      },
      returnFocus: scanButton,
    });
  } catch {
    searchMessage.textContent =
      "The scanner could not load. Search for your card by name, set, or number.";
    searchInput.focus();
  } finally {
    scanButton.disabled = false;
  }
});

let searchTimer;
searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  state.card = null;
  calculateButton.disabled = true;
  resetResult();
  const query = searchInput.value.trim();
  if (query.length < 2) {
    state.request += 1;
    searchResults.replaceChildren();
    searchMessage.textContent = "Start typing to see matching cards.";
    return;
  }
  searchTimer = window.setTimeout(() => searchCards(query), 300);
});

gameSelect.addEventListener("change", () => {
  state.card = null;
  state.condition = null;
  document.querySelectorAll(".condition-option").forEach((option) => {
    option.classList.remove("is-selected");
    option.setAttribute("aria-pressed", "false");
  });
  window.clearTimeout(searchTimer);
  state.request += 1;
  searchResults.replaceChildren();
  searchMessage.textContent =
    "Start typing to search this game’s indexed catalog.";
  calculateButton.disabled = true;
  resetResult();
  const query = searchInput.value.trim();
  if (query.length >= 2) searchCards(query);
});

function renderResult() {
  if (!state.card || !state.condition || state.loading) return;
  const pricing = state.card.pricing?.[state.condition.code];
  if (!pricing || !isPricingUsable(pricing)) {
    const stale = pricing?.source_updated_at && !config.allow_stale_pricing;
    setUnavailable(
      stale
        ? "Online estimate unavailable: reference pricing is stale."
        : "Online estimate unavailable: pricing unavailable for this condition.",
      stale
        ? "Please verify the card in store. We never present stale pricing as current."
        : "We never invent a price or substitute another condition.",
    );
    return;
  }
  const result = calculateOffer(
    pricing.reference_cents,
    parsePercentageToBasisPoints(config.buy_rate ?? "60%"),
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
    `${state.card.name} · ${state.card.card_number} · ${state.condition.name}`;
  resultEmpty.hidden = true;
  resultReady.hidden = false;
  resultUnavailable.hidden = true;
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

calculateButton.addEventListener("click", renderResult);
renderConditions();
