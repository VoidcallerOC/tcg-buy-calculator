export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!process.env.CATALOG_ADMIN_TOKEN || req.headers?.authorization !== `Bearer ${process.env.CATALOG_ADMIN_TOKEN}`)
    return res.status(401).json({ error: "Catalog status requires administrator authorization." });
  const base = String(process.env.SUPABASE_URL ?? "").replace(/\/$/, ""); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return res.status(503).json({ error: "Catalog status requires server-side Supabase credentials." });
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const [games, sets, cards, variants, prices, syncs] = await Promise.all([
      ["tcg_games", "id"], ["tcg_sets", "id"], ["tcg_catalog_cards", "id"], ["tcg_card_variants", "id"], ["tcg_catalog_prices", "id"], ["tcg_sync_runs", "id,status,kind,started_at,finished_at,pages_processed,cards_processed,sets_processed,error&order=started_at.desc&limit=1"],
    ].map(async ([table, select]) => { const response = await fetch(`${base}/rest/v1/${table}?select=${select}&active=eq.true`, { headers }); if (!response.ok) throw new Error(`Unable to read ${table}.`); return response.json(); }));
    return res.status(200).json({ counts: { games: games.length, sets: sets.length, cards: cards.length, variants: variants.length, prices: prices.length }, latest_sync: syncs[0] ?? null });
  } catch (error) { return res.status(502).json({ error: error.message }); }
}
