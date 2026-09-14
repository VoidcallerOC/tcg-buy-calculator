const CARD_GAME_PATTERNS = [
  /magic/i,
  /pokemon/i,
  /yugioh|yu-gi-oh/i,
  /one piece/i,
  /lorcana/i,
  /flesh\s*&?\s*blood/i,
  /digimon/i,
  /dragon ball/i,
  /star wars unlimited/i,
  /gundam/i,
  /riftbound/i,
  /shadowverse/i,
  /union arena/i,
  /battle spirits/i,
  /grand archive/i,
  /sorcery/i,
  /naruto/i,
  /card game|ccg|tcg|keyforge|wixoss|weiss schwarz|force of will|final fantasy/i,
];
const SUPPLY_PATTERNS = [
  /supply|sleeve|deck box|storage|playmat|organizer|album|protective|counter|paint|tool/i,
];
const ACCESSORY_PATTERNS = [/accessor|dice|binder/i];
const NON_CARD_PATTERNS = [/boardgame|warhammer|book|miniature|funko|comic/i];

export function classifyCategory(category) {
  const name = String(category?.name ?? category?.displayName ?? "").trim();
  if (CARD_GAME_PATTERNS.some((pattern) => pattern.test(name)))
    return "CARD_GAME";
  if (SUPPLY_PATTERNS.some((pattern) => pattern.test(name))) return "SUPPLIES";
  if (ACCESSORY_PATTERNS.some((pattern) => pattern.test(name)))
    return "ACCESSORIES";
  if (NON_CARD_PATTERNS.some((pattern) => pattern.test(name)))
    return "NON_CARD_GAME";
  return "OTHER";
}

export function classifyCategories(categories = []) {
  return categories.map((category) => ({
    ...category,
    classification: classifyCategory(category),
  }));
}

export function cardGameCategories(categories = []) {
  return classifyCategories(categories).filter(
    ({ classification }) => classification === "CARD_GAME",
  );
}
