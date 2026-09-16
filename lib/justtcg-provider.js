import { parseMoneyToCents } from "./money.js";
import { mapCondition } from "./tcgplayer-normalizer.js";

const DEFAULT_BASE_URL = "https://api.justtcg.com/v1";
const DEFAULT_PROVIDER_VERSION = "v1-paid-plan";
const MAX_RETRY_DELAY_MS = 30_000;

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
const headerValue = (response, name) => {
  const headers = response?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) ?? "";
  return headers[name] ?? headers[name.toLowerCase()] ?? "";
};
const retryDelayMs = (response, attempt) => {
  const retryAfter = headerValue(response, "retry-after");
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS);
};
const planPageSize = (plan) => {
  const name = String(plan ?? "").toLowerCase();
  if (name.includes("enterprise")) return 200;
  if (name.includes("starter") || name.includes("pro")) return 100;
  if (name.includes("free")) return 20;
  return null;
};
const usageFrom = (body) => body?._metadata ?? body?.usage ?? {};
const isQuotaError = (message) =>
  /daily|monthly|quota|allowance/i.test(message) &&
  !/slow down|too many requests|rate limit exceeded/i.test(message);

export function createJustTcgProvider({
  apiKey = process.env.JUSTTCG_API_KEY,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  maxRetries = 8,
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
  let currentPageSize = pageSize;
  let currentDelayMs = requestDelayMs;
  const setsByGame = new Map();

  function applyUsage(body) {
    const usage = usageFrom(body);
    const planLimit = planPageSize(usage.apiPlan);
    if (planLimit && currentPageSize > planLimit) currentPageSize = planLimit;
    const dailyRemaining = Number(usage.apiDailyRequestsRemaining);
    if (Number.isFinite(dailyRemaining) && dailyRemaining <= 0)
      throw new JustTcgProviderError(
        "JustTCG daily request quota exhausted. Upgrade the plan or retry after 00:00 UTC.",
        { status: 429, retryable: false },
      );
    const rateLimit = Number(usage.apiRateLimit);
    if (Number.isFinite(rateLimit) && rateLimit > 0)
      currentDelayMs = Math.max(
        currentDelayMs,
        Math.ceil(60_000 / rateLimit) + 50,
      );
    else if (
      String(usage.apiPlan ?? "")
        .toLowerCase()
        .includes("free")
    )
      currentDelayMs = Math.max(currentDelayMs, 6_050);
  }

  async function request(path, options = {}) {
    let attempt = 0;
    let requestPath = path;
    while (true) {
      const elapsed = Date.now() - lastRequestAt;
      if (elapsed < currentDelayMs) await sleepImpl(currentDelayMs - elapsed);
      lastRequestAt = Date.now();
      const response = await fetchImpl(`${baseUrl}${requestPath}`, {
        ...options,
        headers: {
          Accept: "application/json",
          "x-api-key": apiKey,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers ?? {}),
        },
      });
      const body = await response.json().catch(() => ({}));
      const message =
        body.error || `JustTCG request failed (${response.status}).`;
      if (response.ok && Array.isArray(body.data)) {
        applyUsage(body);
        return body;
      }
      const limitMatch = message.match(/between 1 and (\d+)/i);
      const allowed = Number(limitMatch?.[1]);
      if (
        response.status === 400 &&
        Number.isInteger(allowed) &&
        allowed >= 1 &&
        allowed < currentPageSize
      ) {
        currentPageSize = allowed;
        requestPath = requestPath.includes("limit=")
          ? requestPath.replace(/limit=\d+/, `limit=${currentPageSize}`)
          : requestPath;
        continue;
      }
      const retryable =
        (response.status === 429 || response.status >= 500) &&
        !isQuotaError(message);
      if (retryable && attempt < maxRetries) {
        await sleepImpl(retryDelayMs(response, attempt));
        attempt += 1;
        continue;
      }
      throw new JustTcgProviderError(message, {
        status: response.status,
        retryable,
      });
    }
  }

  async function page(path, offset = 0) {
    const separator = path.includes("?") ? "&" : "?";
    const body = await request(
      `${path}${separator}limit=${currentPageSize}&offset=${offset}`,
    );
    return {
      data: body.data,
      meta: body.meta ?? {},
      limit: currentPageSize,
      offset,
    };
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
      if (!result.meta.hasMore || count === 0 || count < result.limit) return;
      offset += result.limit;
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
      const params = [
        `game=${encodeURIComponent(gameId)}`,
        "include_null_prices=true",
      ];
      if (setId) params.push(`set=${encodeURIComponent(setId)}`);
      for await (const response of paginate(`/cards?${params.join("&")}`))
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
