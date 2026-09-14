const DEFAULT_BASE_URL = "https://api.tcgplayer.com";
const DEFAULT_API_VERSION = "v1.39.0";

export class TcgplayerProviderNotConfiguredError extends Error {
  constructor() {
    super("TCGplayer provider not configured");
    this.name = "TcgplayerProviderNotConfiguredError";
  }
}

export class TcgplayerApiError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "TcgplayerApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

function requireCredentials(credentials) {
  if (!credentials?.publicKey || !credentials?.privateKey) {
    throw new TcgplayerProviderNotConfiguredError();
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createTcgplayerProvider({
  credentials,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  apiVersion = DEFAULT_API_VERSION,
  pageSize = 100,
  maxRetries = 3,
  now = () => new Date(),
  sleepImpl = sleep,
} = {}) {
  requireCredentials(credentials);
  if (typeof fetchImpl !== "function")
    throw new Error("A fetch implementation is required.");
  let accessToken;
  let tokenExpiresAt = 0;

  async function authenticate() {
    const response = await fetchImpl(`${baseUrl}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: credentials.publicKey,
        client_secret: credentials.privateKey,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) {
      throw new TcgplayerApiError("TCGplayer authentication failed.", {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    accessToken = body.access_token;
    tokenExpiresAt =
      Date.now() + Math.max(60, Number(body.expires_in ?? 3600) - 60) * 1000;
    return accessToken;
  }

  async function token() {
    if (!accessToken || Date.now() >= tokenExpiresAt) return authenticate();
    return accessToken;
  }

  async function request(path, { query = {}, method = "GET", body } = {}) {
    let attempt = 0;
    while (true) {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "")
          params.set(key, String(value));
      });
      const url = `${baseUrl}/${apiVersion}${path}${params.size ? `?${params}` : ""}`;
      const response = await fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `bearer ${await token()}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const responseBody = await response.json().catch(() => ({}));
      if (response.ok && responseBody.success !== false) return responseBody;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        const retryAfter = Number(response.headers?.get?.("retry-after") ?? 0);
        await sleepImpl(
          retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt,
        );
        attempt += 1;
        continue;
      }
      throw new TcgplayerApiError(
        responseBody.errors?.join("; ") ||
          `TCGplayer request failed (${response.status}).`,
        { status: response.status, retryable },
      );
    }
  }

  async function paged(path, query = {}) {
    const results = [];
    let offset = 0;
    let totalItems = Infinity;
    while (offset < totalItems) {
      const page = await request(path, {
        query: { ...query, offset, limit: pageSize },
      });
      const pageResults = Array.isArray(page.results) ? page.results : [];
      results.push(...pageResults);
      totalItems = Number(page.totalItems ?? results.length);
      if (!pageResults.length) break;
      offset += pageResults.length;
    }
    return results;
  }

  return {
    provider: "tcgplayer",
    providerVersion: apiVersion,
    configured: true,
    async getCategories() {
      return paged("/catalog/categories", { sortOrder: "categoryId" });
    },
    async getGroups(categoryId) {
      return paged(
        `/catalog/categories/${encodeURIComponent(categoryId)}/groups`,
        { sortOrder: "groupId" },
      );
    },
    async getProducts({
      categoryId,
      groupId,
      productTypes = "Cards",
      includeSkus = true,
    } = {}) {
      return paged("/catalog/products", {
        categoryId,
        groupId,
        productTypes,
        includeSkus,
      });
    },
    async getPricing(productIds) {
      if (!Array.isArray(productIds) || !productIds.length) return [];
      const results = [];
      for (let index = 0; index < productIds.length; index += 100) {
        const page = await request(
          `/pricing/product/${productIds.slice(index, index + 100).join(",")}`,
        );
        results.push(...(Array.isArray(page.results) ? page.results : []));
      }
      return results;
    },
    async getLastUpdated() {
      return now().toISOString();
    },
  };
}

export function credentialsFromEnv(env = process.env) {
  return {
    publicKey: env.TCGPLAYER_PUBLIC_KEY,
    privateKey: env.TCGPLAYER_PRIVATE_KEY,
  };
}
