const headersFor = (key, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  ...extra,
});

const conditionCode = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return { "near mint": "NM", nm: "NM", "lightly played": "LP", lp: "LP", "moderately played": "MP", mp: "MP", "heavily played": "HP", hp: "HP", damaged: "DMG", dmg: "DMG" }[normalized] ?? null;
};

export function createSupabaseCatalogRepository({
  url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY,
} = {}) {
  if (!url || !key)
    throw new Error(
      "Supabase catalog repository requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1`;
  async function write(table, value, onConflict) {
    const response = await fetch(
      `${endpoint}/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: "POST",
        headers: headersFor(key, {
          Prefer: "resolution=merge-duplicates,return=representation",
        }),
        body: JSON.stringify(value),
      },
    );
    if (!response.ok)
      throw new Error(`Supabase ${table} upsert failed (${response.status}).`);
    return (await response.json())[0];
  }
  async function patch(table, id, value) {
    const response = await fetch(
      `${endpoint}/${table}?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: headersFor(key),
        body: JSON.stringify(value),
      },
    );
    if (!response.ok)
      throw new Error(`Supabase ${table} update failed (${response.status}).`);
  }
  return {
    async startSync(input) {
      const response = await fetch(`${endpoint}/tcg_catalog_sync_runs`, {
        method: "POST",
        headers: headersFor(key, { Prefer: "return=representation" }),
        body: JSON.stringify({
          provider: "justtcg",
          ...input,
          status: "running",
        }),
      });
      return (await response.json())[0];
    },
    async upsertGame(game) {
      return write(
        "tcg_games",
        {
          provider: "justtcg",
          provider_game_id: game.provider_game_id,
          name: game.name,
          normalized_name: game.name.toLowerCase(),
          provider_payload: game.provider_payload ?? {},
          active: true,
        },
        "provider,provider_game_id",
      );
    },
    async upsertSet(set) {
      return write(
        "tcg_sets",
        {
          game_id: set.game_id,
          provider_set_id: set.provider_set_id,
          name: set.name,
          normalized_name: set.name.toLowerCase(),
          set_code: set.set_code,
          release_date: set.release_date,
          provider_payload: set.provider_payload ?? {},
          active: true,
        },
        "game_id,provider_set_id",
      );
    },
    async upsertCard(card) {
      const saved = await write(
        "tcg_catalog_cards",
        {
          game_id: card.game_id,
          set_id: card.set_id ?? null,
          provider_card_id: card.provider_card_id,
          provider_card_slug: card.provider_card_slug,
          name: card.name,
          normalized_name: card.normalized_name,
          card_number: card.card_number,
          image_url: card.image_url,
          rarity: card.rarity,
          provider_payload: card.provider_payload,
          active: true,
          provider_updated_at: card.provider_updated_at,
        },
        "game_id,provider_card_id",
      );
      for (const variant of card.variants) {
        const savedVariant = await write(
          "tcg_card_variants",
          {
            card_id: saved.id,
            provider_variant_id: variant.provider_variant_id,
            condition: variant.condition,
            printing: variant.printing,
            language: variant.language,
            provider_payload: variant.provider_payload,
            active: true,
            provider_updated_at: variant.provider_updated_at,
          },
          "card_id,provider_variant_id",
        );
        if (variant.price !== null && savedVariant?.id)
          await write(
            "tcg_catalog_prices",
            {
              variant_id: savedVariant.id,
              condition_code: conditionCode(variant.condition),
              reference_cents: Math.round(variant.price * 100),
              currency: "USD",
              source_name: "JustTCG",
              source_updated_at: variant.provider_updated_at
                ? new Date(
                    Number(variant.provider_updated_at) * 1000,
                  ).toISOString()
                : new Date().toISOString(),
              active: true,
            },
            "variant_id,condition_code,source_updated_at",
          );
      }
      return saved;
    },
    async updateSyncProgress(id, values) {
      return patch("tcg_catalog_sync_runs", id, values);
    },
    async finishSync(id, values) {
      return patch("tcg_catalog_sync_runs", id, {
        ...values,
        finished_at: new Date().toISOString(),
      });
    },
  };
}
