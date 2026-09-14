import { parseMoneyToCents } from "./money.js";
import { mapCondition } from "./tcgplayer-normalizer.js";

const DEFAULT_BASE_URL = "https://api.justtcg.com/v1";
const DEFAULT_PROVIDER_VERSION = "v1-paid-plan";

export class JustTcgProviderError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "JustTcgProviderError";
    this.status = status;
    this.retryable = retryable;
  }
}

export class JustTcgProviderNotConfiguredError extends Error {
  constructor() {
    super("JustTCG provider requires a server-side JUSTTCG_API_KEY.");
    this.name = "JustTcgProviderNotConfiguredError";
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requiredString(value, field) {
  const result = String(value ?? "").trim();
  if (!result)
    throw new JustTcgProviderError(`JustTCG response missing ${field}.`);
  return result;
}

export function createJustTcgProvider({
  apiKey = process.env.JUSTTCG_API_KEY,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  maxRetries = 3,
  requestDelayMs = 100,
  pageSize = 100,
  sleepImpl = sleep,
  now = () => new Date(),
} = {}) {
  if (!apiKey) throw new JustTcgProviderNotConfiguredError();
  if (typeof fetchImpl !== "function")
    throw new Error("A fetch implementation is required.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new Error("JustTCG pageSize must be between 1 and 100.");
  let lastRequestAt = 0;
  const cardsById = new Map();
  const setsByGame = new Map();

  async function request(path, options = {}) {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < requestDelayMs) await sleepImpl(requestDelayMs - elapsed);
    let attempt = 0;
    while (true) {
      lastRequestAt = Date.now();
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...options,
        headers: {
          Accept: "application/json",
          "x-api-key": apiKey,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers ?? {}),
        },
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(body.data)) return body;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        await sleepImpl(250 * 2 ** attempt);
        attempt += 1;
        continue;
      }
      throw new JustTcgProviderError(
        body.error || `JustTCG request failed (${response.status}).`,
        { status: response.status, retryable },
      );
    }
  }

  async function list(path, options = {}) {
    const result = [];
    let offset = 0;
    while (true) {
      const separator = path.includes("?") ? "&" : "?";
      const body = await request(
        `${path}${separator}limit=${pageSize}&offset=${offset}`,
        options,
      );
      result.push(...body.data);
      if (!body.meta?.hasMore && body.data.length < pageSize) break;
      offset += pageSize;
    }
    return result;
  }

  function normalizeCard(card, category, group) {
    const productId = requiredString(
      card.tcgplayerId ?? card.uuid ?? card.id,
      "card identifier",
    );
    const cardNumber = String(
      card.number ?? card.cardNumber ?? productId,
    ).trim();
    const product = {
      productId,
      name: requiredString(card.name, "card name"),
      cleanName: card.name,
      categoryId: category.categoryId,
      groupId: group.groupId,
      extendedData: [{ name: "card number", value: cardNumber }],
      url: card.uuid
        ? `https://justtcg.com/card/${encodeURIComponent(card.id ?? card.uuid)}`
        : null,
    };
    cardsById.set(productId, card);
    return product;
  }

  return {
    provider: "justtcg",
    providerVersion: DEFAULT_PROVIDER_VERSION,
    pricingScope: "variant",
    configured: true,
    async getCategories() {
      const games = await list("/games");
      return games.map((game, index) => ({
        categoryId: index + 1,
        name: requiredString(game.name ?? game.id, "game name"),
        _gameId: requiredString(game.id, "game ID"),
      }));
    },
    async getGroups(categoryId) {
      const categories = await list("/games");
      const game = categories[categoryId - 1];
      if (!game)
        throw new JustTcgProviderError(
          `Unknown JustTCG category ${categoryId}.`,
        );
      const gameId = requiredString(game.id, "game ID");
      const sets = await list(`/sets?game=${encodeURIComponent(gameId)}`);
      setsByGame.set(categoryId, { gameId, sets });
      return sets.map((set, index) => ({
        groupId: index + 1,
        name: requiredString(set.name ?? set.id, "set name"),
        _setId: requiredString(set.id, "set ID"),
      }));
    },
    async getProducts({ categoryId, groupId } = {}) {
      const state = setsByGame.get(categoryId);
      const set = state?.sets[groupId - 1];
      if (!state || !set)
        throw new JustTcgProviderError(`Unknown JustTCG set ${groupId}.`);
      const cards = await list(
        `/cards?game=${encodeURIComponent(state.gameId)}&set=${encodeURIComponent(set.id)}`,
      );
      return cards.map((card) =>
        normalizeCard(
          card,
          { categoryId },
          { groupId, name: set.name ?? set.id },
        ),
      );
    },
    async getPricing(productIds = []) {
      const lookups = productIds.map((id) => ({ tcgplayerId: String(id) }));
      if (!lookups.length) return [];
      const response = await request("/cards", {
        method: "POST",
        body: JSON.stringify(lookups),
      });
      const fetchedAt = now().toISOString();
      return response.data.flatMap((card) => {
        const productId = String(card.tcgplayerId ?? card.id ?? "");
        return (card.variants ?? []).map((variant) => {
          const price = Number(variant.price);
          if (!Number.isFinite(price) || price < 0)
            throw new JustTcgProviderError(
              `Invalid JustTCG price for ${productId}.`,
            );
          return {
            productId,
            marketPrice: Number(price.toFixed(2)),
            subTypeName: variant.condition,
            sourceUpdatedAt: variant.lastUpdated
              ? new Date(Number(variant.lastUpdated) * 1000).toISOString()
              : fetchedAt,
            source: "JustTCG",
            sourceVariantId: variant.uuid ?? variant.id ?? null,
            reference_cents: parseMoneyToCents(price.toFixed(2)),
          };
        });
      });
    },
    mapCondition,
    async getProviderSnapshot() {
      const fetchedAt = now().toISOString();
      return {
        provider: "justtcg",
        fetched_at: fetchedAt,
        source_updated_at: fetchedAt,
      };
    },
  };
}
