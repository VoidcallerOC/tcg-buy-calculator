import {
  calculateOffer,
  formatMoney,
  formatRate,
  parsePercentageToBasisPoints,
} from "./lib/money.js";
import { addEntry, removeEntry, summarize } from "./lib/offer-list.js";

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
const state = {
  card: null,
  condition: null,
  request: 0,
  loading: false,
  // The result on screen, ready to add to the list; null when none is shown.
  pending: null,
  // Cards collected this visit. In memory only: a reload starts a fresh list,
  // so no estimate outlives the page that priced it.
  list: [],
  added: 0,
};
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
const calculateHint = document.querySelector("#calculate-hint");
const resultsToggle = document.querySelector("#results-toggle");
const addButton = document.querySelector("#add-to-list");
const listSection = document.querySelector("#card-list");
const listItems = document.querySelector("#card-list-items");
const listCount = document.querySelector("#card-list-count");
const listTotal = document.querySelector("#card-list-total");
const listNote = document.querySelector("#card-list-note");
const scanNextButton = document.querySelector("#scan-next");
const clearListButton = document.querySelector("#clear-list");

const gamesResponse = await fetch("/api/games").catch(() => null);
if (gamesResponse?.ok) {
  const gamesBody = await gamesResponse.json().catch(() => ({}));
  const games = Array.isArray(gamesBody.games) ? gamesBody.games : [];
  if (games.length) {
    // Keep the featured games (the static list) first, with their labels and
    // the default selection; other provider games follow alphabetically.
    const featured = [...gameSelect.options].map((option) => ({
      value: option.value,
      label: option.textContent.trim(),
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
// Client theme: primary drives buttons and fills, secondary the accent text.
if (config.primary_color)
  document.documentElement.style.setProperty("--accent", config.primary_color);
if (config.secondary_color)
  document.documentElement.style.setProperty(
    "--accent-text",
    config.secondary_color,
  );

const reducedMotion = window.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
).matches;
const scrollBehavior = reducedMotion ? "auto" : "smooth";

// Explains why Calculate is disabled, or what it will do.
function updateCalculateState() {
  calculateButton.disabled = !state.card || !state.condition || state.loading;
  calculateHint.textContent = !state.card
    ? state.condition
      ? "Select a card to calculate."
      : "Select a card and a condition to calculate."
    : !state.condition
      ? "Choose a condition to calculate."
      : "";
}

// Marks conditions with no usable online price for the selected card, so the
// customer sees it before calculating. Does not change what Calculate shows.
const CONDITION_NOTES = {
  missing: "No online price",
  undated: "Price undated",
  stale: "Price out of date",
};
function updateConditionNotes() {
  for (const option of conditionList.querySelectorAll(".condition-option")) {
    const note = option.querySelector(".condition-note");
    const usability = state.card
      ? pricingState(state.card.pricing?.[option.dataset.code])
      : "usable";
    note.textContent = CONDITION_NOTES[usability] ?? "";
  }
}

function clearCondition() {
  state.condition = null;
  document.querySelectorAll(".condition-option").forEach((option) => {
    option.classList.remove("is-selected");
    option.setAttribute("aria-pressed", "false");
  });
}

// After a pick, show only the chosen card; the full list is one tap away.
function setResultsCollapsed(collapsed) {
  const total = searchResults.querySelectorAll(".search-result").length;
  const canCollapse =
    total > 1 && Boolean(searchResults.querySelector(".is-selected"));
  searchResults.dataset.collapsed = String(collapsed && canCollapse);
  resultsToggle.hidden = !canCollapse;
  resultsToggle.textContent =
    collapsed && canCollapse
      ? `Show all ${total} matches`
      : "Hide other matches";
  resultsToggle.setAttribute("aria-expanded", String(!collapsed));
}

function resetResult() {
  resultEmpty.hidden = false;
  resultReady.hidden = true;
  resultUnavailable.hidden = true;
  state.pending = null;
  addButton.hidden = true;
}

function setUnavailable(title, message) {
  resultEmpty.hidden = true;
  resultReady.hidden = true;
  resultUnavailable.hidden = false;
  resultUnavailable.querySelector("strong").textContent = title;
  resultUnavailable.querySelector("p").textContent = message;
}

// Offer the result on screen for the list: priced, or listed as needing an
// in-store price. Nothing is estimated here; it copies what was shown.
function offerForList(entry) {
  state.pending = entry;
  addButton.textContent =
    entry.offerCents === undefined
      ? "Add to my list without an estimate"
      : "Add to my list";
  addButton.hidden = false;
}

function renderList() {
  const summary = summarize(state.list);
  listSection.hidden = summary.count === 0;
  listItems.replaceChildren();
  for (const item of state.list) {
    const row = document.createElement("li");
    row.className = "card-list-item";
    const info = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = item.label;
    const meta = document.createElement("small");
    meta.textContent =
      item.offerCents === null
        ? `${item.condition} · ${item.unavailable}`
        : `${item.condition} · market ${formatMoney(item.referenceCents, config.currency)}`;
    info.append(name, meta);
    const offer = document.createElement("span");
    offer.className = "card-list-offer";
    offer.textContent =
      item.offerCents === null
        ? "In store"
        : formatMoney(item.offerCents, config.currency);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "card-list-remove";
    remove.textContent = "Remove";
    remove.setAttribute(
      "aria-label",
      `Remove ${item.label}, ${item.condition}`,
    );
    remove.addEventListener("click", () => {
      state.list = removeEntry(state.list, item.key);
      renderList();
      (listSection.hidden ? scanButton : scanNextButton).focus();
    });
    row.append(info, offer, remove);
    listItems.append(row);
  }
  listCount.textContent = `${summary.count} card${summary.count === 1 ? "" : "s"}`;
  listTotal.textContent = formatMoney(summary.offerCents, config.currency);
  listNote.textContent = [
    summary.unpriced
      ? `${summary.unpriced} card${summary.unpriced === 1 ? " has" : "s have"} no online estimate and ${summary.unpriced === 1 ? "is" : "are"} not in the total; the shop prices ${summary.unpriced === 1 ? "it" : "them"} in person.`
      : null,
    "Each estimate uses the market reference shown when it was added. Final offer after in-store inspection.",
  ]
    .filter(Boolean)
    .join(" ");
}

// Back to step 1 for the next card; the list and the game stay as they are.
function clearSelection(message) {
  window.clearTimeout(searchTimer);
  state.request += 1;
  state.card = null;
  clearCondition();
  setSearchLoading(false);
  searchInput.value = "";
  searchResults.replaceChildren();
  setResultsCollapsed(false);
  searchMessage.textContent = message;
  updateConditionNotes();
  updateCalculateState();
  resetResult();
}

function setSearchLoading(loading) {
  state.loading = loading;
  searchInput.setAttribute("aria-busy", String(loading));
  if (loading) searchMessage.textContent = "Searching live card data…";
  updateCalculateState();
}

function renderConditions() {
  for (const condition of conditions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "condition-option";
    button.dataset.code = condition.code;
    const name = document.createElement("span");
    const code = document.createElement("span");
    const note = document.createElement("span");
    name.className = "condition-name";
    code.className = "condition-code";
    note.className = "condition-note";
    name.textContent = condition.name;
    code.textContent = condition.code;
    code.setAttribute("aria-hidden", "true");
    button.append(name, code, note);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      clearCondition();
      state.condition = condition;
      button.classList.add("is-selected");
      button.setAttribute("aria-pressed", "true");
      updateCalculateState();
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
  setResultsCollapsed(true);
  updateConditionNotes();
  updateCalculateState();
  resetResult();
}

const MAX_SHOWN = 12;
function renderSearchResults(cards) {
  searchResults.replaceChildren();
  setResultsCollapsed(false);
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
    details.className = "result-details";
    number.className = "result-number-chip";
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
    clearCondition();
  }
  state.request += 1;
  // A search still in flight is now superseded; don't leave it marked busy.
  setSearchLoading(false);
  renderSearchResults([card]);
  selectCard(
    card,
    searchResults.querySelector(".search-result"),
    "Card confirmed from your scan. Choose a condition below.",
  );
  conditionList.scrollIntoView({ behavior: scrollBehavior, block: "center" });
}

async function openScan(trigger) {
  trigger.disabled = true;
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
      returnFocus: trigger,
    });
  } catch {
    searchMessage.textContent =
      "The scanner could not load. Search for your card by name, set, or number.";
    searchInput.focus();
  } finally {
    trigger.disabled = false;
  }
}
scanButton.addEventListener("click", () => openScan(scanButton));
scanNextButton.addEventListener("click", () => openScan(scanNextButton));

addButton.addEventListener("click", () => {
  if (!state.pending) return;
  state.added += 1;
  state.list = addEntry(state.list, {
    ...state.pending,
    key: `card-${state.added}`,
  });
  const label = state.pending.label;
  renderList();
  clearSelection(`Added ${label}. Scan or search the next card.`);
  listSection.scrollIntoView({ behavior: scrollBehavior, block: "nearest" });
  scanNextButton.focus({ preventScroll: true });
});

clearListButton.addEventListener("click", () => {
  if (!window.confirm("Remove every card from this list?")) return;
  state.list = [];
  renderList();
  scanButton.focus();
});

let searchTimer;
searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  state.card = null;
  // Editing the query drops the previous pick; the old list stays visible
  // until the new results arrive.
  searchResults.querySelectorAll(".search-result").forEach((option) => {
    option.classList.remove("is-selected");
    option.setAttribute("aria-pressed", "false");
  });
  setResultsCollapsed(false);
  updateConditionNotes();
  updateCalculateState();
  resetResult();
  const query = searchInput.value.trim();
  if (query.length < 2) {
    state.request += 1;
    searchResults.replaceChildren();
    setResultsCollapsed(false);
    searchMessage.textContent = "Start typing to see matching cards.";
    return;
  }
  searchTimer = window.setTimeout(() => searchCards(query), 300);
});

gameSelect.addEventListener("change", () => {
  window.clearTimeout(searchTimer);
  state.request += 1;
  state.card = null;
  clearCondition();
  setSearchLoading(false);
  searchResults.replaceChildren();
  setResultsCollapsed(false);
  updateConditionNotes();
  updateCalculateState();
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
    offerForList({
      label: cardLabel(state.card),
      condition: state.condition.name,
      unavailable: {
        stale: "price out of date",
        undated: "price has no date",
        missing: "no price for this condition",
      }[usability],
    });
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
  offerForList({
    label: cardLabel(state.card),
    condition: state.condition.name,
    offerCents: result.offerCents,
    referenceCents: result.referenceCents,
    sourceUpdatedAt: pricing.source_updated_at,
  });
  resultPanel.scrollIntoView({ behavior: scrollBehavior, block: "start" });
}

calculateButton.addEventListener("click", renderResult);
resultsToggle.addEventListener("click", () =>
  setResultsCollapsed(searchResults.dataset.collapsed !== "true"),
);
renderConditions();
updateCalculateState();
