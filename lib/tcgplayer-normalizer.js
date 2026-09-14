import { parseMoneyToCents } from "./money.js";

export const CONDITION_MAP = new Map([
  ["near mint", "NM"],
  ["nm", "NM"],
  ["lightly played", "LP"],
  ["lp", "LP"],
  ["moderately played", "MP"],
  ["mp", "MP"],
  ["heavily played", "HP"],
  ["hp", "HP"],
  ["damaged", "DMG"],
  ["dmg", "DMG"],
]);

export function mapCondition(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase();
  const code = CONDITION_MAP.get(normalized);
  if (!code)
    throw new Error(`Unmapped provider condition: ${value || "blank"}`);
  return code;
}

function requiredString(value, field) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`Provider response missing ${field}.`);
  return result;
}

export function normalizeCategory(category) {
  const categoryId = Number(category?.categoryId);
  if (!Number.isInteger(categoryId) || categoryId <= 0)
    throw new Error("Provider response has an invalid category ID.");
  return {
    categoryId,
    name: requiredString(
      category.name ?? category.displayName,
      "category name",
    ),
  };
}

export function normalizeProduct(product, { category, group } = {}) {
  const providerProductId = String(product?.productId ?? "").trim();
  if (!providerProductId)
    throw new Error("Provider response missing product ID.");
  const cardNumber =
    product.extendedData?.find((item) => /number|card/i.test(item.name ?? ""))
      ?.value ?? providerProductId;
  return {
    provider_product_id: providerProductId,
    name: requiredString(product.name, "product name"),
    clean_name: String(product.cleanName ?? product.name).trim(),
    category_id: Number(product.categoryId ?? category?.categoryId),
    group_id: Number(product.groupId ?? group?.groupId),
    set_name: requiredString(
      group?.name ?? `Group ${product.groupId}`,
      "group name",
    ),
    card_number: requiredString(cardNumber, "card number"),
    image_url: product.imageUrl || null,
    source_url: product.url || null,
    modified_at: product.modifiedOn || null,
    provider_metadata: {
      sku_count: Array.isArray(product.skus) ? product.skus.length : 0,
    },
  };
}

export function selectReferencePrice(
  price,
  { sourceUpdatedAt, fetchedAt = new Date().toISOString() } = {},
) {
  if (price?.marketPrice === null || price?.marketPrice === undefined) {
    return {
      status: "UNAVAILABLE",
      reason: "Provider did not return a market price.",
    };
  }
  const referenceCents = parseMoneyToCents(
    Number(price.marketPrice).toFixed(2),
  );
  return {
    status: "AVAILABLE",
    reference_cents: referenceCents,
    source_updated_at: sourceUpdatedAt ?? null,
    fetched_at: fetchedAt,
    effective_at: fetchedAt,
    source_product_id: String(price.productId),
    source_condition: price.subTypeName || "Normal",
  };
}

export function freshnessStatus(
  sourceUpdatedAt,
  { now = new Date(), staleThresholdDays = 7 } = {},
) {
  if (!sourceUpdatedAt) return "UNKNOWN";
  const ageDays = Math.floor(
    (now.getTime() - new Date(sourceUpdatedAt).getTime()) / 86400000,
  );
  if (ageDays <= 7) return "CURRENT";
  if (ageDays <= staleThresholdDays) return "AGING";
  return "STALE";
}
