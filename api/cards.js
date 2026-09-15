import { mapCondition } from "../lib/tcgplayer-normalizer.js";
import { parseMoneyToCents } from "../lib/money.js";

const API_BASE_URL = "https://api.justtcg.com/v1";
const MAX_RESULTS = 20;
const CARD_NUMBER_RE = /\b([A-Z]{1,8}\d{1,4})[-\s]?([A-Z]?\d{1,4})\b/i;
const REQUEST_TIMEOUT_MS = 12_000;

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
  const cardId = String(card.id ?? card.uuid ?? card.tcgplayerId ?? "").trim();
  const name = String(card.name ?? "").trim();
  if (!cardId || !name) return null;
  const number = String(
    card.number ?? card.cardNumber ?? card.card_number ?? "",
  ).trim();
  const setCode = String(card.set ?? card.set_code ?? "").trim();
  const setName = String(card.set_name ?? setCode).trim();
  const pricing = {};
  for (const variant of Array.isArray(card.variants) ? card.variants : []) {
    let conditionCode;
    try {
      conditionCode = mapCondition(variant?.condition);
      const price = Number(variant?.price);
      if (!Number.isFinite(price) || price < 0) continue;
      const referenceCents = parseMoneyToCents(price.toFixed(2));
      if (pricing[conditionCode]) continue;
      pricing[conditionCode] = {
        reference_cents: referenceCents,
        source_updated_at: normalizeTimestamp(variant?.lastUpdated),
        source_variant_id: variant?.uuid ?? variant?.id ?? null,
      };
    } catch {
      // Provider records are untrusted: skip only the malformed variant.
    }
  }
  return {
    id: cardId,
    name,
    card_number: number || cardId,
    set_code: setCode,
    set_name: setName,
    game: String(card.game ?? "").trim() || null,
    image_url: card.image_url ?? card.imageUrl ?? null,
    pricing,
  };
}

function searchPlan(query) {
  const match = query.match(CARD_NUMBER_RE);
  if (!match) return [{ q: query }];
  const number = `${match[1]}-${match[2]}`.toUpperCase();
  const setToken = match[1].toUpperCase();
  const name = query.replace(match[0], " ").replace(/\s+/g, " ").trim();
  const plan = [{ q: query }, { number }];
  if (name) plan.push({ q: name, number });
  plan.push({ q: setToken, number });
  return plan;
}

async function requestCards(apiKey, params) {
  const searchParams = new URLSearchParams({
    game: process.env.JUSTTCG_GAME_ID || "one-piece",
    limit: String(MAX_RESULTS),
    offset: "0",
  });
  for (const [key, value] of Object.entries(params)) {
    if (value) searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/cards?${searchParams}`, {
      headers: { Accept: "application/json", "x-api-key": apiKey },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("Live pricing provider request failed.");
      error.status = response.status;
      throw error;
    }
    if (!Array.isArray(body.data)) {
      const error = new Error(
        "Live pricing provider returned an invalid response.",
      );
      error.status = 502;
      throw error;
    }
    return body.data;
  } finally {
    clearTimeout(timeout);
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

  try {
    let rawCards = [];
    for (const params of searchPlan(query)) {
      rawCards = await requestCards(apiKey, params);
      if (rawCards.length) break;
    }
    return json(res, 200, {
      cards: rawCards.map(normalizeCard).filter(Boolean),
    });
  } catch (error) {
    const status =
      Number(error?.status) || (error?.name === "AbortError" ? 504 : 502);
    return json(res, status >= 500 ? 502 : status, {
      error: "Live pricing provider request failed.",
    });
  }
}

export { normalizeCard, normalizeTimestamp, searchPlan };
