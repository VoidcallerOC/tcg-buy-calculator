import { evaluatePricingAuthorization } from "../lib/pricing-authorization.js";

const TIMEOUT_MS = 8_000;
const SUCCESS_CACHE =
  "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
const base = () => String(process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const headers = () => ({
  apikey: process.env.SUPABASE_ANON_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});

function send(res, status, body, cache = "no-store") {
  res.status(status).setHeader("Cache-Control", cache).json(body);
}
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
const toGames = (rows, idField) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      provider_game_id: String(row?.[idField] ?? "").trim(),
      name: String(row?.name ?? "").trim(),
    }))
    .filter((game) => game.provider_game_id && game.name);

async function providerGames() {
  if (!evaluatePricingAuthorization().authorized)
    return [
      503,
      { error: "Live pricing is not activated for this calculator." },
    ];
  if (!process.env.JUSTTCG_API_KEY)
    return [503, { error: "Catalog synchronization is not configured." }];
  const response = await fetchWithTimeout("https://api.justtcg.com/v1/games", {
    headers: {
      Accept: "application/json",
      "x-api-key": process.env.JUSTTCG_API_KEY,
    },
  });
  if (!response.ok) return [502, { error: "Game list is unavailable." }];
  const body = await response.json().catch(() => ({}));
  return [200, { source: "provider", games: toGames(body.data, "id") }];
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Method not allowed." });
  }
  try {
    // The indexed catalog may hold only some games; the customer game list
    // comes from the provider whenever the provider is configured.
    if (
      process.env.JUSTTCG_API_KEY ||
      !base() ||
      !process.env.SUPABASE_ANON_KEY
    ) {
      const [status, body] = await providerGames();
      return send(
        res,
        status,
        body,
        status === 200 ? SUCCESS_CACHE : "no-store",
      );
    }
    const response = await fetchWithTimeout(
      `${base()}/rest/v1/tcg_games?active=eq.true&select=provider_game_id,name&order=name.asc`,
      { headers: headers() },
    );
    if (!response.ok) throw new Error("Indexed game catalog unavailable.");
    return send(
      res,
      200,
      {
        source: "indexed-catalog",
        games: toGames(await response.json(), "provider_game_id"),
      },
      SUCCESS_CACHE,
    );
  } catch (error) {
    return send(res, error?.name === "AbortError" ? 504 : 502, {
      error: "Game list is unavailable.",
    });
  }
}
