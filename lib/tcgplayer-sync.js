import {
  normalizeCategory,
  normalizeProduct,
  mapCondition,
  selectReferencePrice,
  freshnessStatus,
} from "./tcgplayer-normalizer.js";

export function createSyncRun({
  provider,
  clientId,
  now = () => new Date(),
  staleThresholdDays = 7,
} = {}) {
  if (!provider) throw new Error("A TCGplayer provider is required.");
  if (!clientId) throw new Error("A client ID is required.");
  const sync = {
    sync_id: crypto.randomUUID(),
    provider: provider.provider,
    provider_version: provider.providerVersion,
    client_id: clientId,
    started_at: now().toISOString(),
    completed_at: null,
    requested_window: "weekly",
    status: "RUNNING",
    categories_attempted: 0,
    categories_succeeded: 0,
    categories_failed: 0,
    products_seen: 0,
    prices_seen: 0,
    prices_changed: 0,
    prices_rejected: 0,
    errors: [],
    categories: [],
    stale_threshold_days: staleThresholdDays,
  };
  return sync;
}

export async function runWeeklySync({
  provider,
  clientId,
  staleThresholdDays = 7,
  now = () => new Date(),
  onCheckpoint = async () => {},
  batchSize = 100,
  sourceUpdatedAt,
} = {}) {
  const sync = createSyncRun({ provider, clientId, now, staleThresholdDays });
  const normalizedPrices = [];
  try {
    const rawCategories = await provider.getCategories();
    const categories = rawCategories.map((category) =>
      normalizeCategory(category),
    );
    sync.categories_attempted = categories.length;
    for (const category of categories) {
      const categoryReport = {
        category_id: category.categoryId,
        name: category.name,
        status: "DISCOVERED",
        groups: 0,
        products: 0,
        prices: 0,
        current: 0,
        stale: 0,
        failed: 0,
      };
      sync.categories.push(categoryReport);
      try {
        const groups = await provider.getGroups(category.categoryId);
        categoryReport.groups = groups.length;
        categoryReport.authorized = true;
        const products = [];
        for (const group of groups) {
          const groupProducts = await provider.getProducts({
            categoryId: category.categoryId,
            groupId: group.groupId,
          });
          products.push(
            ...groupProducts.map((product) =>
              normalizeProduct(product, { category, group }),
            ),
          );
        }
        categoryReport.products = products.length;
        sync.products_seen += products.length;
        for (let index = 0; index < products.length; index += batchSize) {
          const batch = products.slice(index, index + batchSize);
          const prices = await provider.getPricing(
            batch.map((product) => product.provider_product_id),
          );
          sync.prices_seen += prices.length;
          for (const price of prices) {
            try {
              const selected = selectReferencePrice(price, {
                sourceUpdatedAt: price.sourceUpdatedAt ?? sourceUpdatedAt,
                fetchedAt: now().toISOString(),
              });
              if (selected.status !== "AVAILABLE") {
                sync.prices_rejected += 1;
                continue;
              }
              selected.condition_code = provider.mapCondition
                ? provider.mapCondition(selected.source_condition)
                : mapCondition(selected.source_condition);
              selected.provider = provider.provider;
              selected.provider_version = provider.providerVersion;
              selected.freshness_status = freshnessStatus(
                selected.source_updated_at,
                { now: now(), staleThresholdDays },
              );
              normalizedPrices.push({ ...selected, client_id: clientId });
              categoryReport.prices += 1;
              if (selected.freshness_status === "STALE")
                categoryReport.stale += 1;
              else categoryReport.current += 1;
            } catch (error) {
              sync.prices_rejected += 1;
              sync.errors.push({
                category_id: category.categoryId,
                message: error.message,
              });
            }
          }
          await onCheckpoint({
            sync,
            category: categoryReport,
            offset: index + batch.length,
          });
        }
        categoryReport.status = categoryReport.failed ? "PARTIAL" : "SYNCED";
        sync.categories_succeeded += 1;
      } catch (error) {
        categoryReport.status = error.status === 403 ? "UNAVAILABLE" : "FAILED";
        categoryReport.failed += 1;
        sync.categories_failed += 1;
        sync.errors.push({
          category_id: category.categoryId,
          message: error.message,
        });
      }
    }
    sync.status = sync.categories_failed
      ? sync.categories_succeeded
        ? "PARTIAL"
        : "FAILED"
      : "READY_TO_PUBLISH";
    sync.completed_at = now().toISOString();
    sync.normalized_prices = normalizedPrices;
    return sync;
  } catch (error) {
    sync.status = "FAILED";
    sync.completed_at = now().toISOString();
    sync.errors.push({ message: error.message });
    return sync;
  }
}
