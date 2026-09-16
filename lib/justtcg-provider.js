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

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const requiredString = (value, field) => {
  const result = String(value ?? "").trim();
  if (!result)
    throw new JustTcgProviderError(`JustTCG response missing ${field}.`);
  return result;
};

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
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200)
    throw new Error("JustTCG pageSize must be between 1 and 200.");
  let lastRequestAt = 0;
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

  async function page(path, offset = 0) {
    const separator = path.includes("?") ? "&" : "?";
    const body = await request(
      `${path}${separator}limit=${pageSize}&offset=${offset}`,
    );
    return { data: body.data, meta: body.meta ?? {}, limit: pageSize, offset };
  }

  async function* paginate(path) {
    let offset = 0;
    const seenOffsets = new Set();
    while (true) {
      if (seenOffsets.has(offset))
        throw new JustTcgProviderError(
          `JustTCG pagination loop detected at offset ${offset}.`,
        );
      seenOffsets.add(offset);
      const result = await page(path, offset);
      yield result;
      const count = result.data.length;
      if (!result.meta.hasMore || count === 0 || count < pageSize) return;
      offset += pageSize;
    }
  }

  async function collect(path) {
    const result = [];
    for await (const response of paginate(path)) result.push(...response.data);
    return result;
  }

  function normalizeGame(game) {
    const id = requiredString(game.id, "game ID");
    return {
      provider_game_id: id,
      id,
      name: requiredString(game.name ?? id, "game name"),
      provider_payload: game,
    };
  }
  function normalizeSet(set) {
    const id = requiredString(set.id, "set ID");
    return {
      provider_set_id: id,
      id,
      name: requiredString(set.name ?? id, "set name"),
      set_code: set.code ?? null,
      release_date: set.releaseDate ?? set.release_date ?? null,
      provider_payload: set,
    };
  }

  return {
    provider: "justtcg",
    providerVersion: DEFAULT_PROVIDER_VERSION,
    pricingScope: "variant",
    configured: true,
    async getGames() {
      return (await collect("/games")).map(normalizeGame);
    },
    async getSets(gameId) {
      const sets = (
        await collect(`/sets?game=${encodeURIComponent(gameId)}`)
      ).map(normalizeSet);
      setsByGame.set(gameId, sets);
      return sets;
    },
    async *iterCards({ gameId, setId } = {}) {
      for await (const response of paginate(
        `/cards?game=${encodeURIComponent(gameId)}&set=${encodeURIComponent(setId)}&include_null_prices=true`,
      ))
        yield response;
    },
    async getCategories() {
      return (await this.getGames()).map((game, index) => ({
        categoryId: index + 1,
        name: game.name,
        _gameId: game.provider_game_id,
      }));
    },
    async getGroups(categoryId) {
      const games = await this.getGames();
      const game = games[categoryId - 1];
      if (!game)
        throw new JustTcgProviderError(
          `Unknown JustTCG category ${categoryId}.`,
        );
      const sets = await this.getSets(game.provider_game_id);
      return sets.map((set, index) => ({
        groupId: index + 1,
        name: set.name,
        _setId: set.provider_set_id,
      }));
    },
    async getProducts({ categoryId, groupId } = {}) {
      const games = await this.getGames();
      const game = games[categoryId - 1];
      const sets = game
        ? (setsByGame.get(game.provider_game_id) ??
          (await this.getSets(game.provider_game_id)))
        : [];
      const set = sets[groupId - 1];
      if (!game || !set)
        throw new JustTcgProviderError(`Unknown JustTCG set ${groupId}.`);
      const cards = [];
      for await (const response of this.iterCards({
        gameId: game.provider_game_id,
        setId: set.provider_set_id,
      }))
        cards.push(...response.data);
      return cards.map((card) => ({
        productId: String(card.tcgplayerId ?? card.uuid ?? card.id),
        provider_product_id: String(card.tcgplayerId ?? card.uuid ?? card.id),
        name: requiredString(card.name, "card name"),
        cleanName: card.name,
        categoryId,
        groupId,
        extendedData: [
          {
            name: "card number",
            value: String(card.number ?? card.cardNumber ?? card.id),
          },
        ],
        url: card.id
          ? `https://justtcg.com/card/${encodeURIComponent(card.id)}`
          : null,
      }));
    },
    async getPricing(productIds = []) {
      const lookups = productIds.map((id) => ({ tcgplayerId: String(id) }));
      if (!lookups.length) return [];
      const response = await request("/cards", {
        method: "POST",
        body: JSON.stringify(lookups),
      });
      const fetchedAt = now().toISOString();
      return response.data.flatMap((card) =>
        (card.variants ?? []).map((variant) => {
          const price = Number(variant.price);
          if (!Number.isFinite(price) || price < 0)
            throw new JustTcgProviderError(
              `Invalid JustTCG price for ${card.tcgplayerId ?? card.id}.`,
            );
          return {
            productId: String(card.tcgplayerId ?? card.id ?? ""),
            marketPrice: Number(price.toFixed(2)),
            subTypeName: variant.condition,
            sourceUpdatedAt: variant.lastUpdated
              ? new Date(Number(variant.lastUpdated) * 1000).toISOString()
              : fetchedAt,
            source: "JustTCG",
            sourceVariantId: variant.uuid ?? variant.id ?? null,
            reference_cents: parseMoneyToCents(price.toFixed(2)),
          };
        }),
      );
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
