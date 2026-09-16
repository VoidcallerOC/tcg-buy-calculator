const headersFor = (key, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  ...extra,
});
const chunks = (items, size = 100) => {
  const result = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
};
const conditionCode = (value) =>
  ({
    "near mint": "NM",
    nm: "NM",
    "lightly played": "LP",
    lp: "LP",
    "moderately played": "MP",
    mp: "MP",
    "heavily played": "HP",
    hp: "HP",
    damaged: "DMG",
    dmg: "DMG",
  })[
    String(value ?? "")
      .trim()
      .toLowerCase()
  ] ?? null;
const timestampValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 100000000000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export function createSupabaseCatalogRepository({
  url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY,
  batchSize = 100,
} = {}) {
  if (!url || !key)
    throw new Error(
      "Supabase catalog repository requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1`;
  async function writeMany(table, values, onConflict) {
    if (!values.length) return [];
    const response = await fetch(
      `${endpoint}/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: "POST",
        headers: headersFor(key, {
          Prefer: "resolution=merge-duplicates,return=representation",
        }),
        body: JSON.stringify(values),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `Supabase ${table} upsert failed (${response.status}): ${detail}`,
      );
    }
    return response.json();
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
  async function upsertCards(cards) {
    const savedCards = [];
    for (const batch of chunks(cards, batchSize))
      savedCards.push(
        ...(await writeMany(
          "tcg_catalog_cards",
          batch.map((card) => ({
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
            provider_updated_at: timestampValue(card.provider_updated_at),
          })),
          "game_id,provider_card_id",
        )),
      );
    const variants = [];
    for (let index = 0; index < cards.length; index += 1)
      for (const variant of cards[index].variants)
        variants.push({
          card_id: savedCards[index]?.id,
          provider_variant_id: variant.provider_variant_id,
          condition: variant.condition,
          printing: variant.printing,
          language: variant.language,
          provider_payload: variant.provider_payload,
          active: true,
          provider_updated_at: timestampValue(variant.provider_updated_at),
          price: variant.price,
          source_updated_at:
            timestampValue(variant.provider_updated_at) ??
            new Date().toISOString(),
        });
    const savedVariants = [];
    for (const batch of chunks(variants, batchSize))
      savedVariants.push(
        ...(await writeMany(
          "tcg_card_variants",
          batch.map(({ price, source_updated_at, ...variant }) => variant),
          "card_id,provider_variant_id",
        )),
      );
    const prices = [];
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      if (
        variant.price !== null &&
        Number.isFinite(variant.price) &&
        conditionCode(variant.condition) &&
        savedVariants[index]?.id
      )
        prices.push({
          variant_id: savedVariants[index].id,
          condition_code: conditionCode(variant.condition),
          reference_cents: Math.round(variant.price * 100),
          currency: "USD",
          source_name: "JustTCG",
          source_updated_at: variant.source_updated_at,
          active: true,
        });
    }
    for (const batch of chunks(prices, batchSize))
      await writeMany(
        "tcg_catalog_prices",
        batch,
        "variant_id,condition_code,source_updated_at",
      );
    return {
      cards: savedCards.length,
      variants: savedVariants.length,
      prices: prices.length,
    };
  }
  return {
    async startSync(input) {
      const rows = await writeMany(
        "tcg_catalog_sync_runs",
        [{ provider: "justtcg", ...input, status: "running" }],
        "id",
      );
      return rows[0];
    },
    async upsertGame(game) {
      const rows = await writeMany(
        "tcg_games",
        [
          {
            provider: "justtcg",
            provider_game_id: game.provider_game_id,
            name: game.name,
            normalized_name: game.name.toLowerCase(),
            provider_payload: game.provider_payload ?? {},
            active: true,
          },
        ],
        "provider,provider_game_id",
      );
      return rows[0];
    },
    async upsertSet(set) {
      const rows = await writeMany(
        "tcg_sets",
        [
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
        ],
        "game_id,provider_set_id",
      );
      return rows[0];
    },
    async upsertCard(card) {
      return (await upsertCards([card])).cards ? card : null;
    },
    async upsertCards(cards) {
      return upsertCards(cards);
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
