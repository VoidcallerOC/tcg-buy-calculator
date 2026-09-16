export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed." });
  if (
    !process.env.CATALOG_ADMIN_TOKEN ||
    req.headers?.authorization !== `Bearer ${process.env.CATALOG_ADMIN_TOKEN}`
  )
    return res
      .status(401)
      .json({ error: "Catalog status requires administrator authorization." });
  const base = String(process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key)
    return res
      .status(503)
      .json({
        error: "Catalog status requires server-side Supabase credentials.",
      });
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: "count=exact",
  };
  const readCount = async (table, active = true) => {
    const filter = active ? "&active=eq.true" : "";
    const response = await fetch(
      `${base}/rest/v1/${table}?select=id${filter}&limit=1`,
      { headers },
    );
    if (!response.ok) throw new Error(`Unable to read ${table}.`);
    const range = response.headers.get("content-range") ?? "*/0";
    return Number(range.split("/").at(-1)) || 0;
  };
  const readLatest = async () => {
    const response = await fetch(
      `${base}/rest/v1/tcg_catalog_sync_runs?select=id,status,kind,started_at,finished_at,pages_processed,cards_processed,sets_processed,error&order=started_at.desc&limit=1`,
      { headers },
    );
    if (!response.ok) throw new Error("Unable to read tcg_catalog_sync_runs.");
    const rows = await response.json();
    return rows[0] ?? null;
  };
  try {
    const [games, sets, cards, variants, prices, syncRuns, latest] =
      await Promise.all([
        readCount("tcg_games"),
        readCount("tcg_sets"),
        readCount("tcg_catalog_cards"),
        readCount("tcg_card_variants"),
        readCount("tcg_catalog_prices"),
        readCount("tcg_catalog_sync_runs", false),
        readLatest(),
      ]);
    return res
      .status(200)
      .json({
        counts: { games, sets, cards, variants, prices, sync_runs: syncRuns },
        latest_sync: latest,
      });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}
