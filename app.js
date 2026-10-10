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
    // Keep the featured games (the static list) first, with their labels and
    // the default selection; other provider games follow alphabetically.
    const featured = [...gameSelect.options].map((option) => ({
      value: option.value,
      label: option.textContent,
    }));
    const selected = gameSelect.value;
    const rank = (id) => {
      const index = featured.findIndex((game) => game.value === id);
      return index === -1 ? featured.length : index;
    };
    const ordered = games
      .map((game) => ({
        value: String(game.provider_game_id ?? game.id ?? ""),
        label: String(game.name ?? ""),
      }))
      .filter((game) => game.value)
      .sort(
        (a, b) =>
          rank(a.value) - rank(b.value) || a.label.localeCompare(b.label),
      );
    gameSelect.replaceChildren(
      ...ordered.map((game) => {
        const option = document.createElement("option");
        option.value = game.value;
        option.textContent =
          featured.find((item) => item.value === game.value)?.label ||
          game.label ||
          game.value;
        return option;
      }),
    );
    if (ordered.some((game) => game.value === selected))
      gameSelect.value = selected;
  }
}

// "usable" | "missing" | "undated" | "stale". A price without a source date
// cannot be shown as current, so it is never usable.
function pricingState(pricing) {
  if (!pricing || !Number.isSafeInteger(pricing.reference_cents))
    return "missing";
  const updatedAt = new Date(pricing.source_updated_at ?? NaN).getTime();
  if (!Number.isFinite(updatedAt)) return "undated";
  if (config.allow_stale_pricing) return "usable";
  const thresholdMs = Number(config.stale_threshold_days ?? 7) * 86400000;
  return Date.now() - updatedAt <= thresholdMs ? "usable" : "stale";
}

// Printing/language distinguish copies that share a name and number.
function variantLabel(card) {
  return [card.printing, card.language === "English" ? null : card.language]
    .filter(Boolean)
    .join(" · ");
}
function cardLabel(card) {
  return [card.name, card.card_number, variantLabel(card)]
    .filter(Boolean)
    .join(" · ");
}

for (const element of document.querySelectorAll("[data-client-name]"))
  element.textContent = config.business_name;
document.querySelector("[data-disclaimer]").textContent = config.disclaimer;
document.querySelector("[data-data-status]").textContent =
  "Market reference pricing from JustTCG — final offer subject to in-store verification.";
document.querySelector("[data-pricing-status]").textContent =
  "Market references are JustTCG market observations, not a quote. Prices older than " +
  `${Number(config.stale_threshold_days ?? 7)} days are never used for an estimate.`;
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
  searchInput.value = cardLabel(card);
  searchMessage.textContent = message;
  calculateButton.disabled = !state.condition;
  resetResult();
}

const MAX_SHOWN = 12;
function renderSearchResults(cards) {
  searchResults.replaceChildren();
  if (!cards.length) {
    searchMessage.textContent =
      "No matching cards found. Try a card number or set code.";
    return;
  }
  const shown = cards.slice(0, MAX_SHOWN);
  searchMessage.textContent =
    cards.length > shown.length
      ? `Showing ${shown.length} of ${cards.length} matches. Add a set or card number to narrow it down.`
      : `${cards.length} matching card${cards.length === 1 ? "" : "s"}. Select one to continue.`;
  shown.forEach((card) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.setAttribute("aria-pressed", "false");
    const details = document.createElement("span");
    const name = document.createElement("strong");
    const set = document.createElement("small");
    const number = document.createElement("span");
    name.textContent = card.name;
    set.textContent =
      [card.set_name, variantLabel(card), card.rarity]
        .filter(Boolean)
        .join(" · ") || "Set not listed";
    number.textContent = card.card_number || "No number";
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
  window.clearTimeout(searchTimer);
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
  window.clearTimeout(searchTimer);
  state.request += 1;
  state.card = null;
  state.condition = null;
  document.querySelectorAll(".condition-option").forEach((option) => {
    option.classList.remove("is-selected");
    option.setAttribute("aria-pressed", "false");
  });
  setSearchLoading(false);
  searchResults.replaceChildren();
  calculateButton.disabled = true;
  resetResult();
  const query = searchInput.value.trim();
  if (query.length < 2) {
    searchMessage.textContent =
      "Start typing to search this game’s indexed catalog.";
    return;
  }
  searchTimer = window.setTimeout(() => searchCards(query), 300);
});

function renderResult() {
  if (!state.card || !state.condition || state.loading) return;
  const pricing = state.card.pricing?.[state.condition.code];
  const usability = pricingState(pricing);
  if (usability !== "usable") {
    const [title, message] = {
      stale: [
        "Online estimate unavailable: reference pricing is stale.",
        "Please verify the card in store. We never present stale pricing as current.",
      ],
      undated: [
        "Online estimate unavailable: the reference price has no date.",
        "Please verify the card in store. We never present undated pricing as current.",
      ],
      missing: [
        "Online estimate unavailable: pricing unavailable for this condition.",
        "We never invent a price or substitute another condition or printing.",
      ],
    }[usability];
    setUnavailable(title, message);
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
    `${cardLabel(state.card)} · ${state.condition.name}`;
  document.querySelector("#result-source").textContent =
    `Market reference: JustTCG, updated ${new Date(
      pricing.source_updated_at,
    ).toLocaleDateString("en-US", { dateStyle: "medium" })}.`;
  resultEmpty.hidden = true;
  resultReady.hidden = false;
  resultUnavailable.hidden = true;
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

calculateButton.addEventListener("click", renderResult);
renderConditions();
