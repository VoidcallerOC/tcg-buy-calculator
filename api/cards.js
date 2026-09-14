import { mapCondition } from "../lib/tcgplayer-normalizer.js";
import { parseMoneyToCents } from "../lib/money.js";

const API_BASE_URL = "https://api.justtcg.com/v1";
const MAX_RESULTS = 20;

function json(res, status, body) {
  res.status(status).setHeader("Cache-Control", "no-store").json(body);
}

function normalizeCard(card) {
  const cardId = String(card.id ?? card.uuid ?? "").trim();
  const name = String(card.name ?? "").trim();
  if (!cardId || !name) return null;
  const number = String(
    card.number ?? card.cardNumber ?? card.card_number ?? "",
  ).trim();
  const setCode = String(card.set ?? "").trim();
  const setName = String(card.set_name ?? setCode).trim();
  const pricing = {};
  for (const variant of Array.isArray(card.variants) ? card.variants : []) {
    let conditionCode;
    try {
      conditionCode = mapCondition(variant.condition);
    } catch {
      continue;
    }
    const price = Number(variant.price);
    if (!Number.isFinite(price) || price < 0) continue;
    if (pricing[conditionCode]) continue;
    pricing[conditionCode] = {
      reference_cents: parseMoneyToCents(price.toFixed(2)),
      source_updated_at: variant.lastUpdated
        ? new Date(Number(variant.lastUpdated) * 1000).toISOString()
        : null,
      source_variant_id: variant.uuid ?? variant.id ?? null,
    };
  }
  return {
    id: cardId,
    name,
    card_number: number || cardId,
    set_code: setCode,
    set_name: setName,
    image_url: card.image_url ?? card.imageUrl ?? null,
    pricing,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "Method not allowed." });
  }
  const query = String(req.query?.q ?? "").trim();
  if (query.length < 2 || query.length > 120) {
    return json(res, 400, {
      error: "Search must be between 2 and 120 characters.",
    });
  }
  const apiKey = process.env.JUSTTCG_API_KEY;
  if (!apiKey)
    return json(res, 503, {
      error: "Live pricing provider is not configured.",
    });

  const params = new URLSearchParams({
    q: query,
    game: process.env.JUSTTCG_GAME_ID || "one-piece",
    limit: String(MAX_RESULTS),
    offset: "0",
  });
  try {
    const response = await fetch(`${API_BASE_URL}/cards?${params}`, {
      headers: { Accept: "application/json", "x-api-key": apiKey },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(res, response.status >= 500 ? 502 : response.status, {
        error: "Live pricing provider request failed.",
      });
    }
    const cards = (Array.isArray(body.data) ? body.data : [])
      .map(normalizeCard)
      .filter(Boolean);
    return json(res, 200, { cards });
  } catch {
    return json(res, 502, { error: "Live pricing provider is unavailable." });
  }
}
