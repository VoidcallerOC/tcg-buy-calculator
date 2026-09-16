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
export const conditionCode = (value) =>
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
export const timestampValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 100000000000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
export const parseProviderPrice = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
};
const variantKey = (variant) =>
  `${variant.card_id}:${variant.provider_variant_id ?? ""}`;

export function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key) map.set(key, item);
  }
  return [...map.values()];
}

export function buildPriceRows(savedVariantsByKey, variants) {
  const prices = new Map();
  for (const variant of variants) {
    const saved = savedVariantsByKey.get(variantKey(variant));
    const code = conditionCode(variant.condition);
    const price = parseProviderPrice(variant.price);
    if (!saved?.id || !code || price === null) continue;
    const key = `${saved.id}:${code}`;
    const row = {
      variant_id: saved.id,
      condition_code: code,
      reference_cents: Math.round(price * 100),
      currency: "USD",
      source_name: "JustTCG",
      source_updated_at:
        timestampValue(variant.provider_updated_at) ??
        timestampValue(variant.source_updated_at) ??
        new Date().toISOString(),
      active: true,
    };
    const existing = prices.get(key);
    if (
      !existing ||
      String(row.source_updated_at) >= String(existing.source_updated_at)
    )
      prices.set(key, row);
  }
  return [...prices.values()];
}

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
  async function publishPrices(prices) {
    if (!prices.length) return 0;
    let published = 0;
    for (const batch of chunks(prices, batchSize)) {
      const response = await fetch(
        `${endpoint}/rpc/tcg_catalog_publish_prices`,
        {
          method: "POST",
          headers: headersFor(key),
          body: JSON.stringify({ p_prices: batch }),
        },
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(
          `Supabase tcg_catalog_publish_prices failed (${response.status}): ${detail}`,
        );
      }
      published += Number(await response.json()) || batch.length;
    }
    return published;
  }
  async function upsertCards(cards) {
    const savedCards = [];
    const cardRows = uniqueBy(
      cards.map((card) => ({
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
      (card) => `${card.game_id}:${card.provider_card_id}`,
    );
    for (const batch of chunks(cardRows, batchSize))
      savedCards.push(
        ...(await writeMany(
          "tcg_catalog_cards",
          batch,
          "game_id,provider_card_id",
        )),
      );
    const savedCardsByKey = new Map(
      savedCards.map((card) => [
        `${card.game_id}:${card.provider_card_id}`,
        card,
      ]),
    );
    const variants = uniqueBy(
      cards.flatMap((card) => {
        const saved = savedCardsByKey.get(
          `${card.game_id}:${card.provider_card_id}`,
        );
        return (card.variants ?? []).map((variant) => ({
          card_id: saved?.id,
          provider_variant_id: variant.provider_variant_id,
          condition: variant.condition,
          printing: variant.printing,
          language: variant.language,
          provider_payload: variant.provider_payload,
          active: true,
          provider_updated_at: timestampValue(variant.provider_updated_at),
          price: variant.price,
          source_updated_at: timestampValue(variant.provider_updated_at),
        }));
      }),
      variantKey,
    ).filter((variant) => variant.card_id);
    const savedVariants = [];
    for (const batch of chunks(variants, batchSize))
      savedVariants.push(
        ...(await writeMany(
          "tcg_card_variants",
          batch.map(({ price, source_updated_at, ...variant }) => variant),
          "card_id,provider_variant_id",
        )),
      );
    const savedVariantsByKey = new Map(
      savedVariants.map((variant) => [variantKey(variant), variant]),
    );
    const prices = buildPriceRows(savedVariantsByKey, variants);
    await publishPrices(prices);
    return {
      cards: savedCards.length,
      variants: savedVariants.length,
      prices: prices.length,
    };
  }
  return {
    async getLatestSync() {
      const response = await fetch(
        `${endpoint}/tcg_catalog_sync_runs?select=id,status,games_processed,pages_processed,cards_processed,sets_processed,error,started_at&order=started_at.desc&limit=1`,
        { headers: headersFor(key) },
      );
      if (!response.ok) return null;
      const rows = await response.json();
      return rows[0] ?? null;
    },
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
