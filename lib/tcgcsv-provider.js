const DEFAULT_BASE_URL = "https://tcgcsv.com";
const DEFAULT_USER_AGENT = "ForgeCT-TCG-Buy-Calculator/1.0";

export class TcgcsvProviderError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "TcgcsvProviderError";
    this.status = status;
    this.retryable = retryable;
  }
}

export class TcgcsvProviderNotConfiguredError extends Error {
  constructor() {
    super("TCGCSV provider not configured");
    this.name = "TcgcsvProviderNotConfiguredError";
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createTcgcsvProvider({
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  userAgent = DEFAULT_USER_AGENT,
  maxRetries = 3,
  requestDelayMs = 100,
  sleepImpl = sleep,
  now = () => new Date(),
  variationConditionMap = {},
} = {}) {
  if (typeof fetchImpl !== "function")
    throw new Error("A fetch implementation is required.");
  if (!userAgent.trim())
    throw new Error("TCGCSV requires a descriptive User-Agent.");
  let lastRequestAt = 0;
  const productGroups = new Map();
  const groupPrices = new Map();

  async function request(path, { retry = true } = {}) {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < requestDelayMs) await sleepImpl(requestDelayMs - elapsed);
    let attempt = 0;
    while (true) {
      lastRequestAt = Date.now();
      const response = await fetchImpl(`${baseUrl}${path}`, {
        headers: { Accept: "application/json", "User-Agent": userAgent },
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.success !== false) return body;
      const retryable = response.status === 429 || response.status >= 500;
      if (retry && retryable && attempt < maxRetries) {
        await sleepImpl(250 * 2 ** attempt);
        attempt += 1;
        continue;
      }
      throw new TcgcsvProviderError(
        body.errors?.join("; ") ||
          `TCGCSV request failed (${response.status}).`,
        { status: response.status, retryable },
      );
    }
  }

  async function getJson(path) {
    return request(path);
  }

  async function getLastUpdated() {
    const response = await fetchImpl(`${baseUrl}/last-updated.txt`, {
      headers: { Accept: "text/plain", "User-Agent": userAgent },
    });
    if (!response.ok)
      throw new TcgcsvProviderError(
        `TCGCSV freshness request failed (${response.status}).`,
        { status: response.status, retryable: response.status >= 500 },
      );
    return (await response.text()).trim();
  }

  return {
    provider: "tcgcsv",
    providerVersion: "documented-json-endpoints",
    pricingScope: "product",
    configured: true,
    getLastUpdated,
    async getCategories() {
      return (await getJson("/tcgplayer/categories")).results ?? [];
    },
    async getGroups(categoryId) {
      return (
        (await getJson(`/tcgplayer/${encodeURIComponent(categoryId)}/groups`))
          .results ?? []
      );
    },
    async getProducts({ categoryId, groupId } = {}) {
      const products =
        (
          await getJson(
            `/tcgplayer/${encodeURIComponent(categoryId)}/${encodeURIComponent(groupId)}/products`,
          )
        ).results ?? [];
      products.forEach((product) =>
        productGroups.set(String(product.productId), { categoryId, groupId }),
      );
      return products;
    },
    async getPricing(productIds = []) {
      const byGroup = new Map();
      productIds.forEach((productId) => {
        const group = productGroups.get(String(productId));
        if (group) byGroup.set(`${group.categoryId}/${group.groupId}`, group);
      });
      const prices = [];
      for (const [key, group] of byGroup) {
        if (!groupPrices.has(key)) {
          groupPrices.set(
            key,
            (
              await getJson(
                `/tcgplayer/${encodeURIComponent(group.categoryId)}/${encodeURIComponent(group.groupId)}/prices`,
              )
            ).results ?? [],
          );
        }
        prices.push(
          ...groupPrices
            .get(key)
            .filter(
              (price) =>
                productIds.includes(price.productId) ||
                productIds.includes(String(price.productId)),
            ),
        );
      }
      return prices;
    },
    mapCondition(variation) {
      const code =
        variationConditionMap[
          String(variation ?? "")
            .trim()
            .toLocaleLowerCase()
        ];
      if (!code)
        throw new Error(`Unmapped TCGCSV variation: ${variation || "blank"}`);
      return code;
    },
    async getProviderSnapshot() {
      return {
        provider: "tcgcsv",
        fetched_at: now().toISOString(),
        source_updated_at: await getLastUpdated(),
      };
    },
  };
}
