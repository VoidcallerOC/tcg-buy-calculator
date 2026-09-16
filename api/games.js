const base = () => String(process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const headers = () => ({ apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}` });
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  try {
    if (base() && process.env.SUPABASE_ANON_KEY) {
      const response = await fetch(`${base()}/rest/v1/tcg_games?active=eq.true&select=provider_game_id,name&order=name.asc`, { headers: headers() });
      if (!response.ok) throw new Error("Indexed game catalog unavailable.");
      return res.status(200).json({ source: "indexed-catalog", games: await response.json() });
    }
    if (!process.env.JUSTTCG_API_KEY) return res.status(503).json({ error: "Catalog synchronization is not configured." });
    const response = await fetch("https://api.justtcg.com/v1/games", { headers: { Accept: "application/json", "x-api-key": process.env.JUSTTCG_API_KEY } });
    const body = await response.json();
    return res.status(response.ok ? 200 : 502).json({ source: "provider", games: body.data ?? [] });
  } catch (error) { return res.status(502).json({ error: error.message }); }
}
