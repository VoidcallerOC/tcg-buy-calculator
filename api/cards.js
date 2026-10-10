import { CONDITION_MAP } from "../lib/tcgplayer-normalizer.js";
import { evaluatePricingAuthorization } from "../lib/pricing-authorization.js";

const API_BASE_URL = "https://api.justtcg.com/v1";
const MAX_RESULTS = 20;
const MAX_PROVIDER_REQUESTS = 4;
const REQUEST_TIMEOUT_MS = 12_000;
const CATALOG_TIMEOUT_MS = 6_000;
const ALIASES = {
  "one-piece": "one-piece-card-game",
  "flesh-and-blood": "flesh-and-blood-tcg",
};
const GAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
// Shared CDN cache for identical searches: keeps the provider quota for new
// lookups while prices stay well inside the client freshness threshold.
const SUCCESS_CACHE =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=300";

class SearchError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function json(res, status, body, cache = "no-store") {
  res.status(status).setHeader("Cache-Control", cache).json(body);
}
function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function conditionCode(value) {
  return (
    CONDITION_MAP.get(
      String(value ?? "")
        .trim()
        .toLocaleLowerCase(),
    ) ?? null
  );
}
function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function variantPrice(variant) {
  // Only a current, finite, non-negative provider price is a usable reference.
  if (variant.priceStatus && variant.priceStatus !== "current") return null;
  if (variant.reference_cents != null) {
    const cents = Number(variant.reference_cents);
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
  }
  if (variant.price === null || variant.price === undefined) return null;
  const price = Number(variant.price);
  return Number.isFinite(price) && price >= 0 ? Math.round(price * 100) : null;
}

// One provider card becomes one calculator entry per printing/language, so a
// Foil price is never applied to a Normal copy (or vice versa). Cards whose
// variants carry no card condition (sealed product) are not calculator cards.
function normalizeCard(card) {
  if (!card || typeof card !== "object") return [];
  const cardId = String(
    card.provider_card_id ?? card.id ?? card.uuid ?? card.tcgplayerId ?? "",
  ).trim();
  const name = String(card.name ?? "").trim();
  if (!cardId || !name) return [];
  const variants = Array.isArray(card.variants) ? card.variants : [];
  const groups = new Map();
  for (const variant of variants) {
    const code = conditionCode(variant.condition_code ?? variant.condition);
    if (!code) continue;
    const printing = String(variant.printing ?? "").trim() || null;
    const language = String(variant.language ?? "").trim() || null;
    const key = `${printing ?? ""}|${language ?? ""}`;
    if (!groups.has(key)) groups.set(key, { printing, language, pricing: {} });
    const cents = variantPrice(variant);
    if (cents === null) continue;
    const pricing = groups.get(key).pricing;
    const entry = {
      reference_cents: cents,
      source_updated_at: normalizeTimestamp(
        variant.source_updated_at ?? variant.lastUpdated,
      ),
      source_variant_id:
        variant.provider_variant_id ?? variant.uuid ?? variant.id ?? null,
    };
    // Two prices for one printing/language/condition is ambiguous: offer none.
    if (pricing[code] && pricing[code].reference_cents !== cents)
      pricing[code] = { ambiguous: true };
    else if (!pricing[code]) pricing[code] = entry;
  }
  if (variants.length && !groups.size) return [];
  if (!groups.size)
    groups.set("|", { printing: null, language: null, pricing: {} });
  for (const group of groups.values())
    for (const [code, entry] of Object.entries(group.pricing))
      if (entry.ambiguous) delete group.pricing[code];
  const base = {
    provider_card_id: cardId,
    name,
    card_number: String(card.card_number ?? card.number ?? "").trim(),
    set_code: String(card.set_code ?? card.set ?? "").trim(),
    set_name: String(card.set_name ?? "").trim(),
    game: card.game_id ?? card.game ?? null,
    image_url: card.image_url ?? null,
    rarity: card.rarity ?? null,
  };
  return [...groups.values()].map((group) => ({
    ...base,
    id:
      groups.size > 1 || group.printing || group.language
        ? [cardId, slug(group.printing), slug(group.language)]
            .filter(Boolean)
            .join("::")
        : cardId,
    printing: group.printing,
    language: group.language,
    pricing: group.pricing,
  }));
}

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Indexed catalog (Supabase). Returns null when it is not configured or does
// not hold this game, so the live provider is used; a valid empty search of an
// indexed game stays empty.
async function catalogSearch(query, gameId) {
  const base = String(process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const gameResponse = await fetchWithTimeout(
    `${base}/rest/v1/tcg_games?provider_game_id=eq.${encodeURIComponent(gameId)}&select=id,provider_game_id,name&limit=1`,
    { headers },
    CATALOG_TIMEOUT_MS,
  );
  if (!gameResponse.ok) throw new Error("Indexed catalog game lookup failed.");
  const games = await gameResponse.json();
  if (!games[0]) return null;
  const response = await fetchWithTimeout(
    `${base}/rest/v1/rpc/tcg_catalog_search`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_game_id: games[0].id,
        p_query: query,
        p_limit: MAX_RESULTS,
      }),
    },
    CATALOG_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error("Indexed catalog search failed.");
  const cards = await response.json();
  if (!cards.length) return [];
  const ids = cards.map((card) => card.id).join(",");
  const variantsResponse = await fetchWithTimeout(
    `${base}/rest/v1/tcg_card_variants?card_id=in.(${ids})&select=card_id,provider_variant_id,condition,printing,language,tcg_catalog_prices(reference_cents,source_updated_at,active,condition_code)`,
    { headers },
    CATALOG_TIMEOUT_MS,
  );
  if (!variantsResponse.ok) throw new Error("Indexed catalog pricing failed.");
  const variants = await variantsResponse.json();
  const byCard = new Map(
    cards.map((card) => [card.id, { ...card, game_id: gameId, variants: [] }]),
  );
  for (const variant of variants)
    for (const price of variant.tcg_catalog_prices ?? [])
      if (price.active)
        byCard.get(variant.card_id)?.variants.push({ ...variant, ...price });
  return [...byCard.values()].flatMap(normalizeCard);
}

// Printed collector numbers: OP05-060, ST18-005, LOB-EN001, 199/165, TG01/TG30.
export function collectorNumber(query) {
  const slash = query.match(
    /\b([A-Z]{0,3}\d{1,4})\s?\/\s?([A-Z]{0,3}\d{1,4})\b/i,
  );
  if (slash) return `${slash[1]}/${slash[2]}`.toUpperCase();
  const dash = query.match(
    /\b([A-Z]{1,6}\d{0,3})-([A-Z]{0,3}\d{1,4}[A-Z]?)\b/i,
  );
  if (dash) return `${dash[1]}-${dash[2]}`.toUpperCase();
  const spaced = query.match(/\b([A-Z]{1,4}\d{1,3})\s?([A-Z]{0,2}\d{3})\b/i);
  if (spaced) return `${spaced[1]}-${spaced[2]}`.toUpperCase();
  return null;
}

function searchPlans(query) {
  const number = collectorNumber(query);
  const plans = [];
  if (number) plans.push({ number });
  plans.push({ q: query });
  const words = query.split(" ");
  // "<card name> <set>" and set-only searches: resolve the set, then filter.
  plans.push({ set: query, q: null });
  for (let split = words.length - 1; split >= 1; split -= 1)
    plans.push({
      set: words.slice(split).join(" "),
      q: words.slice(0, split).join(" "),
    });
  return plans;
}

function providerError(response, body) {
  if (response.status === 429)
    return new SearchError(
      "The pricing provider is busy or its daily limit was reached. Try again later or verify in store.",
      503,
    );
  if (response.status === 401 || response.status === 403)
    return new SearchError("Live pricing provider authorization failed.", 502);
  if (response.status >= 400 && response.status < 500 && body?.error)
    return new SearchError("Live pricing provider rejected the search.", 502);
  return new SearchError("Live pricing provider request failed.", 502);
}

async function providerSearch(query, gameId) {
  const apiKey = process.env.JUSTTCG_API_KEY;
  if (!apiKey)
    throw new SearchError("Live pricing provider is not configured.", 503);
  let requests = 0;
  const call = async (path, params) => {
    if (requests >= MAX_PROVIDER_REQUESTS) return null;
    requests += 1;
    let response;
    try {
      response = await fetchWithTimeout(
        `${API_BASE_URL}/${path}?${new URLSearchParams(params)}`,
        { headers: { Accept: "application/json", "x-api-key": apiKey } },
        REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      if (error?.name === "AbortError")
        throw new SearchError("Live pricing provider timed out.", 504);
      throw new SearchError("Live pricing provider is unreachable.", 502);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError(response, body);
    return Array.isArray(body.data) ? body.data : [];
  };
  const cards = async (filters) =>
    (
      (await call("cards", {
        game: gameId,
        ...filters,
        include_null_prices: "true",
        limit: String(MAX_RESULTS),
        offset: "0",
      })) ?? []
    ).flatMap(normalizeCard);

  const sets = new Map();
  for (const plan of searchPlans(query)) {
    let found;
    if (plan.set !== undefined) {
      if (!sets.has(plan.set)) {
        const matches = await call("sets", {
          game: gameId,
          q: plan.set,
          limit: "1",
        });
        if (matches === null) break;
        sets.set(plan.set, matches[0]?.id ?? null);
      }
      const setId = sets.get(plan.set);
      if (!setId) continue;
      found = await cards({ set: setId, ...(plan.q ? { q: plan.q } : {}) });
    } else found = await cards(plan);
    if (found.length) return found;
    if (requests >= MAX_PROVIDER_REQUESTS) break;
  }
  return [];
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "Method not allowed." });
  }
  // Customer searches come from this site; the endpoint is not a public
  // provider proxy for other sites (JustTCG terms prohibit re-exposure).
  if (req.headers?.["sec-fetch-site"] === "cross-site")
    return json(res, 403, { error: "Cross-site card search is not allowed." });
  const query = String(req.query?.q ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const requested = String(req.query?.game ?? "one-piece-card-game")
    .trim()
    .toLowerCase();
  const game = ALIASES[requested] ?? requested;
  if (query.length < 2 || query.length > 120)
    return json(res, 400, {
      error: "Search must be between 2 and 120 characters.",
    });
  if (!GAME_PATTERN.test(game))
    return json(res, 400, { error: "Unknown card game." });
  const gate = evaluatePricingAuthorization();
  if (!gate.authorized)
    return json(res, 503, {
      error: "Live pricing is not activated for this calculator.",
    });
  try {
    let cards = null;
    let source = "provider";
    try {
      cards = await catalogSearch(query, game);
      if (cards !== null) source = "indexed-catalog";
    } catch {
      /* Indexed catalog unavailable — fall through to the live provider. */
    }
    if (cards === null) {
      cards = await providerSearch(query, game);
      source = "provider";
    }
    return json(
      res,
      200,
      { game, source, pricing_source: "JustTCG", cards },
      SUCCESS_CACHE,
    );
  } catch (error) {
    const status = error instanceof SearchError ? error.status : 502;
    return json(res, status, {
      error:
        error instanceof SearchError ? error.message : "Card search failed.",
    });
  }
}
export { normalizeCard, normalizeTimestamp };
