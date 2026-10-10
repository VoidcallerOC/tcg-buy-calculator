// The customer's running list of cards (several cards in one visit or one show
// table). Pure: entries carry exactly what the calculator already showed. A
// card without a usable online estimate can be listed, but it is never priced
// and never counted in the total.

/**
 * @param {{ key: string, label: string, condition: string, offerCents?: number|null,
 *   referenceCents?: number|null, sourceUpdatedAt?: string|null, unavailable?: string|null }} entry
 */
export function makeEntry(entry) {
  const priced =
    Number.isSafeInteger(entry.offerCents) &&
    entry.offerCents >= 0 &&
    Number.isSafeInteger(entry.referenceCents) &&
    entry.referenceCents >= 0;
  return {
    key: String(entry.key),
    label: String(entry.label ?? ""),
    condition: String(entry.condition ?? ""),
    offerCents: priced ? entry.offerCents : null,
    referenceCents: priced ? entry.referenceCents : null,
    sourceUpdatedAt: priced ? (entry.sourceUpdatedAt ?? null) : null,
    unavailable: priced ? null : String(entry.unavailable ?? "No estimate"),
  };
}

export const addEntry = (list, entry) => [...list, makeEntry(entry)];
export const removeEntry = (list, key) =>
  list.filter((item) => item.key !== key);

export function summarize(list) {
  let offerCents = 0;
  let referenceCents = 0;
  let priced = 0;
  for (const item of list) {
    if (item.offerCents === null) continue;
    offerCents += item.offerCents;
    referenceCents += item.referenceCents;
    priced += 1;
  }
  if (
    !Number.isSafeInteger(offerCents) ||
    !Number.isSafeInteger(referenceCents)
  )
    throw new Error("List total is too large to represent safely.");
  return {
    count: list.length,
    priced,
    unpriced: list.length - priced,
    offerCents,
    referenceCents,
  };
}
