export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function first(...values) {
  return values.find(
    (value) =>
      value !== undefined && value !== null && String(value).trim() !== "",
  );
}

export function normalizeCatalogCard(card, game, set) {
  const providerCardId = String(
    first(card.uuid, card.id, card.tcgplayerId) ?? "",
  ).trim();
  const name = String(first(card.name, card.cleanName) ?? "").trim();
  if (!providerCardId || !name)
    throw new Error("Card is missing a stable identifier or name.");
  const providerSetId = String(
    first(card.set, set?.id, set?.setId) ?? "",
  ).trim();
  const cardNumber = String(
    first(card.number, card.cardNumber, card.card_number, providerCardId) ?? "",
  ).trim();
  return {
    provider_game_id: String(
      first(game.provider_game_id, game.id) ?? "",
    ).trim(),
    game_name: String(game.name ?? "").trim(),
    provider_card_id: providerCardId,
    provider_card_slug: String(card.id ?? "").trim() || null,
    name,
    normalized_name: normalizeText(name),
    provider_set_id: providerSetId || null,
    set_name: String(
      first(card.set_name, set?.name, providerSetId) ?? "",
    ).trim(),
    set_code:
      String(first(card.set_code, card.setCode, card.set) ?? "").trim() || null,
    card_number: cardNumber,
    image_url: first(card.image_url, card.imageUrl, card.image) ?? null,
    rarity: first(card.rarity) ?? null,
    provider_updated_at: card.updatedAt ?? card.updated_at ?? null,
    provider_payload: card,
    variants: (Array.isArray(card.variants) ? card.variants : []).map(
      (variant) => ({
        provider_variant_id:
          String(
            first(variant.uuid, variant.id, variant.tcgplayerSkuId) ?? "",
          ).trim() || null,
        condition: String(variant.condition ?? "").trim() || null,
        printing: String(variant.printing ?? "").trim() || null,
        language: String(variant.language ?? "").trim() || null,
        provider_updated_at:
          variant.lastUpdated ?? variant.last_updated ?? null,
        provider_payload: variant,
        price:
          Number.isFinite(Number(variant.price)) && Number(variant.price) >= 0
            ? Number(variant.price)
            : null,
      }),
    ),
  };
}

export async function syncCatalog({
  provider,
  repository,
  logger = () => {},
  games = null,
}) {
  const sync = await repository.startSync({ kind: "catalog" });
  let pages = 0;
  let cards = 0;
  let sets = 0;
  try {
    const selectedGames = games ?? (await provider.getGames());
    for (const game of selectedGames) {
      const storedGame = await repository.upsertGame(game);
      const gameSets = await provider.getSets(
        game.provider_game_id ?? game.id,
        (progress) => {
          pages += progress.pages ?? 0;
        },
      );
      for (const set of gameSets) {
        const storedSet = await repository.upsertSet({
          ...set,
          game_id: storedGame.id,
        });
        sets += 1;
        for await (const page of provider.iterCards({
          gameId: game.provider_game_id ?? game.id,
          setId: set.provider_set_id ?? set.id,
        })) {
          pages += 1;
          const normalizedCards = page.data.map((card) => {
            const normalized = normalizeCatalogCard(card, game, storedSet);
            normalized.game_id = storedGame.id;
            normalized.set_id = storedSet.id;
            return normalized;
          });
          if (repository.upsertCards)
            await repository.upsertCards(normalizedCards);
          else
            for (const card of normalizedCards)
              await repository.upsertCard(card);
          cards += normalizedCards.length;
          await repository.updateSyncProgress(sync.id, {
            pages_processed: pages,
            cards_processed: cards,
            sets_processed: sets,
          });
          logger({
            game: game.provider_game_id ?? game.id,
            pages,
            cards,
            sets,
          });
        }
      }
    }
    await repository.finishSync(sync.id, {
      status: "completed",
      pages_processed: pages,
      cards_processed: cards,
      sets_processed: sets,
    });
    return {
      sync_id: sync.id,
      games: selectedGames.length,
      sets,
      cards,
      pages,
    };
  } catch (error) {
    await repository.finishSync(sync.id, {
      status: "failed",
      pages_processed: pages,
      cards_processed: cards,
      sets_processed: sets,
      error: error.message,
    });
    throw error;
  }
}

export function createMemoryCatalogRepository() {
  const games = new Map();
  const sets = new Map();
  const cards = new Map();
  const syncs = [];
  return {
    games,
    sets,
    cards,
    syncs,
    async startSync(input) {
      const sync = { id: `sync-${syncs.length + 1}`, ...input };
      syncs.push(sync);
      return sync;
    },
    async upsertGame(game) {
      const value = { id: `${game.provider_game_id ?? game.id}`, ...game };
      games.set(value.id, value);
      return value;
    },
    async upsertSet(set) {
      const value = {
        id: `${set.game_id}:${set.provider_set_id ?? set.id}`,
        ...set,
      };
      sets.set(value.id, value);
      return value;
    },
    async upsertCard(card) {
      const value = {
        id: `${card.provider_game_id}:${card.provider_card_id}`,
        ...card,
      };
      cards.set(value.id, value);
      return value;
    },
    async updateSyncProgress(id, patch) {
      Object.assign(
        syncs.find((item) => item.id === id),
        patch,
      );
    },
    async finishSync(id, patch) {
      Object.assign(
        syncs.find((item) => item.id === id),
        patch,
      );
    },
  };
}

export async function* pagesFromList(listPage) {
  let offset = 0;
  while (true) {
    const page = await listPage(offset);
    yield page;
    const count = page.data?.length ?? 0;
    if (!page.meta?.hasMore && count === 0) return;
    if (!page.meta?.hasMore && count < page.limit) return;
    offset += page.limit;
  }
}
