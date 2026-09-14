function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

export function searchCards(cards, query) {
  const needle = normalize(query);
  if (!needle) return [];
  return cards.filter((card) =>
    [card.name, card.card_number, card.set_code, card.set_name].some((field) =>
      normalize(field).includes(needle),
    ),
  );
}

export function findPricing(pricing, { cardId, conditionCode }) {
  const matches = pricing.filter(
    (record) =>
      record.card_id === cardId &&
      record.condition_code === conditionCode &&
      record.active !== false,
  );
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous pricing: ${matches.length} active records found for ${cardId}/${conditionCode}.`,
    );
  }
  return matches[0] ?? null;
}

export function uniqueSets(cards) {
  return [
    ...new Map(
      cards.map((card) => [
        card.set_code,
        { code: card.set_code, name: card.set_name },
      ]),
    ).values(),
  ];
}
