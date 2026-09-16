import { mapCondition } from "../lib/tcgplayer-normalizer.js";

const API_BASE_URL = "https://api.justtcg.com/v1";
const MAX_RESULTS = 20;
const REQUEST_TIMEOUT_MS = 12_000;
const ALIASES = { "one-piece": "one-piece-card-game" };

function json(res, status, body) {
  res.status(status).setHeader("Cache-Control", "no-store").json(body);
}
function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function normalizeCard(card) {
  if (!card || typeof card !== "object") return null;
  const cardId = String(
    card.provider_card_id ?? card.uuid ?? card.id ?? card.tcgplayerId ?? "",
  ).trim();
  const name = String(card.name ?? "").trim();
  if (!cardId || !name) return null;
  const pricing = {};
  for (const variant of Array.isArray(card.variants) ? card.variants : []) {
    try {
      const conditionCode = mapCondition(
        variant.condition_code ?? variant.condition,
      );
      const price = Number(
        variant.reference_cents != null
          ? variant.reference_cents / 100
          : variant.price,
      );
      if (!Number.isFinite(price) || price < 0) continue;
      pricing[conditionCode] ??= {
        reference_cents: Math.round(price * 100),
        source_updated_at: normalizeTimestamp(
          variant.source_updated_at ?? variant.lastUpdated,
        ),
        source_variant_id:
          variant.provider_variant_id ?? variant.uuid ?? variant.id ?? null,
      };
    } catch {
      /* malformed provider rows are unavailable */
    }
  }
  return {
    id: cardId,
    name,
    card_number: String(card.card_number ?? card.number ?? cardId),
    set_code: String(card.set_code ?? card.set ?? ""),
    set_name: String(card.set_name ?? ""),
    game: card.game ?? null,
    image_url: card.image_url ?? null,
    rarity: card.rarity ?? null,
    pricing,
  };
}
async function catalogSearch(query, gameId) {
  const base = String(process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const gameResponse = await fetch(
    `${base}/rest/v1/tcg_games?provider_game_id=eq.${encodeURIComponent(gameId)}&select=id,provider_game_id,name&limit=1`,
    { headers },
  );
  if (!gameResponse.ok) throw new Error("Indexed catalog game lookup failed.");
  const games = await gameResponse.json();
  if (!games[0]) return [];
  const response = await fetch(`${base}/rest/v1/rpc/tcg_catalog_search`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_game_id: games[0].id,
      p_query: query,
      p_limit: 20,
    }),
  });
  if (!response.ok) throw new Error("Indexed catalog search failed.");
  const cards = await response.json();
  if (!cards.length) return [];
  const ids = cards.map((card) => card.id).join(",");
  const variantsResponse = await fetch(
    `${base}/rest/v1/tcg_card_variants?card_id=in.(${ids})&select=card_id,provider_variant_id,condition,printing,language,tcg_catalog_prices(reference_cents,source_updated_at,active,condition_code)`,
    { headers },
  );
  const variants = variantsResponse.ok ? await variantsResponse.json() : [];
  const byCard = new Map(
    cards.map((card) => [card.id, { ...card, variants: [] }]),
  );
  for (const variant of variants)
    for (const price of variant.tcg_catalog_prices ?? [])
      if (price.active)
        byCard.get(variant.card_id)?.variants.push({ ...variant, ...price });
  return [...byCard.values()].map(normalizeCard).filter(Boolean);
}
async function providerSearch(query, gameId) {
  const apiKey = process.env.JUSTTCG_API_KEY;
  if (!apiKey)
    throw Object.assign(new Error("Live pricing provider is not configured."), {
      status: 503,
    });
  const numberMatch = query.match(
    /\b([A-Z]{1,8}\d{1,4})[-\s]?([A-Z]?\d{1,4})\b/i,
  );
  const plans = [{ q: query }];
  if (numberMatch)
    plans.push({ number: `${numberMatch[1]}-${numberMatch[2]}`.toUpperCase() });
  for (const plan of plans) {
    const params = new URLSearchParams({
      game: ALIASES[gameId] ?? gameId ?? "one-piece-card-game",
      ...plan,
      limit: String(MAX_RESULTS),
      offset: "0",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE_URL}/cards?${params}`, {
        headers: { Accept: "application/json", "x-api-key": apiKey },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Object.assign(
          new Error("Live pricing provider request failed."),
          {
            status: response.status,
          },
        );
      const cards = (body.data ?? []).map(normalizeCard).filter(Boolean);
      if (cards.length || plan === plans.at(-1)) return cards;
    } finally {
      clearTimeout(timeout);
    }
  }
}
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "Method not allowed." });
  }
  const query = String(req.query?.q ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const game = String(req.query?.game ?? "one-piece-card-game").trim();
  if (query.length < 2 || query.length > 120)
    return json(res, 400, {
      error: "Search must be between 2 and 120 characters.",
    });
  try {
    const indexed = await catalogSearch(query, ALIASES[game] ?? game);
    const cards = indexed ?? (await providerSearch(query, game));
    return json(res, 200, {
      game: ALIASES[game] ?? game,
      source: indexed ? "indexed-catalog" : "provider-fallback",
      cards,
    });
  } catch (error) {
    const status =
      Number(error.status) || (error.name === "AbortError" ? 504 : 502);
    return json(res, status === 503 ? 503 : status >= 500 ? 502 : status, {
      error: error.message || "Card search failed.",
    });
  }
}
export { normalizeCard, normalizeTimestamp };
