// CatalogMatcher: searches the calculator's existing catalog (live API or the
// labeled demo catalog, via the injected `search`) with the clues a scan
// produced, scores what comes back, and decides how sure we are. It never
// auto-selects: even IDENTIFIED is shown to the customer for confirmation.

import { GAME_PATTERNS } from "./game-patterns.js";

export const MATCH_STATUS = {
  IDENTIFIED: "IDENTIFIED",
  NEEDS_CONFIRMATION: "NEEDS_CONFIRMATION",
  NOT_IDENTIFIED: "NOT_IDENTIFIED",
};

const IDENTIFIED_SCORE = 0.85;
const IDENTIFIED_MARGIN = 0.25;
const CANDIDATE_SCORE = 0.35;
const MAX_QUERIES = 4;
const MAX_CANDIDATES = 5;

export function normalizeNumber(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\b0+(\d)/g, "$1");
}

// The printed collector number of a catalog entry. Some providers append the
// rarity after a space ("BT16-082 R"); the card itself prints only the code.
const printedNumber = (value) =>
  normalizeNumber(
    String(value ?? "")
      .trim()
      .split(/\s+/)[0],
  );

// The name as printed on the card. Catalogs tell printings apart with labels
// the card does not print: "Monkey.D.Luffy (119) (SP) (Gold)",
// "Nami - OP01-016 (Alternate Art)", "Charizard ex - 199/165". Comparing the
// read name with those labels attached made the plain printing (fewest extra
// words) look like the better match, though the text read says nothing about
// which printing is in hand.
export function printedName(name) {
  return String(name ?? "")
    .replace(/\s*[([][^)\]]*[)\]]/g, " ")
    .replace(/\s+-\s+\S*\d\S*.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Catalog-only printing labels: parenthetical / bracket tags that are not a
// collector number. Used only when OCR (or a typed correction) actually read
// matching text — never to prefer the plain printing by default.
export function variantLabels(name) {
  const labels = [];
  for (const match of String(name ?? "").matchAll(/[(\[]([^)\]]+)[)\]]/g)) {
    const label = match[1].replace(/\s+/g, " ").trim();
    if (!label) continue;
    // "(119)", "(012)", "(OP05-119)", "(OP01-016)" are numbers, not printings.
    if (/^[A-Z]{0,6}\d{0,3}-?\d{1,4}[A-Z]?$/i.test(label)) continue;
    if (/^[\d./-]+$/.test(label)) continue;
    labels.push(label);
  }
  return labels;
}

function tokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// Dice coefficient over word tokens: 1 for identical names, 0 for disjoint.
// A shared single letter counts only alongside a shared word: One Piece's
// "D." is in both Monkey.D.Luffy and Rocks.D.Xebec, and a misread number for
// one must not borrow a name match from the other.
export function nameSimilarity(a, b) {
  const left = tokens(a),
    right = tokens(b);
  if (!left.length || !right.length) return 0;
  const pool = [...right];
  let words = 0,
    letters = 0;
  for (const token of left) {
    const index = pool.findIndex(
      (other) =>
        other === token ||
        (token.length > 3 &&
          other.length > 3 &&
          (other.startsWith(token) || token.startsWith(other))),
    );
    if (index >= 0) {
      if (token.length > 1) words += 1;
      else letters += 1;
      pool.splice(index, 1);
    }
  }
  const shared = words ? words + letters : 0;
  return (2 * shared) / (left.length + right.length);
}

// How clearly OCR / typed clues support a catalog printing label. Short labels
// ("SP") only count as their own name line; longer phrases may appear in the
// raw OCR text. Without a hit, every printing of the same printed name ties.
export function labelEvidence(label, clues) {
  const names = clues?.names ?? [];
  const fromNames = Math.max(
    0,
    ...names.map((name) => nameSimilarity(name, label)),
  );
  if (fromNames >= 0.8) return fromNames;
  const needle = tokens(label).join(" ");
  if (needle.length < 5) return 0;
  const haystack = tokens(clues?.text).join(" ");
  if (haystack && haystack.includes(needle)) return 1;
  return 0;
}

export function scoreCandidate(card, clues) {
  const number = printedNumber(card.card_number);
  const numberMatch = (clues.identifiers ?? []).some(
    (item) => normalizeNumber(item.query) === number,
  );
  const nameScore = Math.max(
    0,
    ...(clues.names ?? []).map((name) =>
      nameSimilarity(name, printedName(card.name)),
    ),
  );
  const setMatch = (clues.setCodes ?? []).some(
    (code) => code.toUpperCase() === String(card.set_code ?? "").toUpperCase(),
  );
  const setNameScore = Math.max(
    0,
    ...(clues.setNames ?? []).map((set) =>
      nameSimilarity(set, card.set_name ?? ""),
    ),
  );
  const setNameMatch = setNameScore >= 0.6;
  const labelHit = Math.max(
    0,
    ...variantLabels(card.name).map((label) => labelEvidence(label, clues)),
    // Finish / edition printed as the provider `printing` field (1st Edition,
    // Unlimited, Reverse Holofoil…) when OCR read that phrase.
    card.printing ? labelEvidence(card.printing, clues) : 0,
  );
  // Base evidence is unchanged so equal printings still tie when nothing about
  // the printing was read. Label / set-name hits raise an uncapped `rank` so
  // an alt print can lead (and clear IDENTIFIED) without the plain name ever
  // winning just by having fewer catalog words.
  let base =
    (numberMatch ? 0.6 : 0) +
    nameScore * 0.4 +
    (setMatch ? 0.1 : 0) +
    (setNameMatch ? 0.1 : 0);
  if (!(clues.identifiers ?? []).length)
    base = nameScore * 0.8 + (setNameMatch ? 0.1 : 0); // name-only caps below IDENTIFIED without labels
  const rank = base + labelHit * 0.3;
  // A number was read and this card's number differs: show the conflict
  // instead of letting a name match quietly stand in for the card.
  const readNumbers = (clues.identifiers ?? [])
    .filter((item) => item.query)
    .map((item) => item.raw ?? item.query);
  const numberConflict =
    !numberMatch && readNumbers.length > 0 && Boolean(card.card_number);
  // The reverse: the number matches but a name read, which looks like a
  // printed name, fits this card not at all. A misread number ("OPOS-110"
  // for OP05-119) is a real code of another card, so a number match alone
  // must not stand in for the card either. Art and OCR fragments ("CHARALI",
  // "Pla") are not name evidence and raise no conflict.
  // Needs at least one name-like read, and no text read may fit the card
  // ("Mew" fits Mew ex even though only "Abilit" looks like a printed name).
  // A printing-label hit is name evidence too: OCR of "Wanted Poster" fits
  // Monkey.D.Luffy (Wanted Poster) even though the printed character name was
  // not read.
  const nameConflict =
    numberMatch &&
    nameScore === 0 &&
    labelHit === 0 &&
    (clues.names ?? []).some((name) => /[A-Z][a-z]{3,}/.test(name));
  return {
    score: Math.min(1, Number(rank.toFixed(3))),
    rank: Number(rank.toFixed(3)),
    numberMatch,
    numberConflict,
    nameConflict,
    readNumbers: numberConflict ? readNumbers : [],
    nameScore: Number(nameScore.toFixed(3)),
    labelHit: Number(labelHit.toFixed(3)),
    setMatch,
    setNameMatch,
  };
}

// Printings (Normal / Reverse Holofoil / 1st Edition…) of one card share its
// identity evidence, so they share a score. The shortlist is capped by
// distinct cards, keeping every printing of each listed card together.
const cardKey = (item) =>
  `${item.game}:${item.card.provider_card_id ?? item.card.id}`;

// Searches to run: printed identifiers first (most specific), then names.
// The selected game is searched first; a game whose identifier format was read
// on the card is also searched, so a One Piece code is not forced into Pokémon.
const PATTERNED_GAMES = new Set(GAME_PATTERNS.map((entry) => entry.game));

export function planQueries(clues, selectedGame) {
  const games = [selectedGame, ...clues.identifiers.map((item) => item.game)]
    .filter((game, index, all) => game && all.indexOf(game) === index)
    .slice(0, 2);
  const plan = [];
  // A number format tags a game by shape only: "69/204" reads as Pokémon but is
  // also how Lorcana, Universus and others print numbers. When the customer's
  // selected game has no format of its own, everything read is searched in
  // that game, and other games are not searched (or charged against quota).
  if (selectedGame && !PATTERNED_GAMES.has(selectedGame)) {
    for (const item of clues.identifiers)
      plan.push({ game: selectedGame, query: item.query });
    for (const name of clues.names.slice(0, 2))
      plan.push({ game: selectedGame, query: name });
    return dedupe(plan).slice(0, MAX_QUERIES);
  }
  for (const item of clues.identifiers)
    if (games.includes(item.game))
      plan.push({ game: item.game, query: item.query });
  for (const name of clues.names.slice(0, 2))
    for (const game of games) plan.push({ game, query: name });
  return dedupe(plan).slice(0, MAX_QUERIES);
}

function dedupe(plan) {
  return plan.filter(
    (step, index, all) =>
      all.findIndex(
        (other) => other.game === step.game && other.query === step.query,
      ) === index,
  );
}

/**
 * @param {object} clues from extractClues
 * @param {{ selectedGame: string, search: (query: string, game: string) => Promise<object[]> }} options
 *   `search` is the calculator's own lookup; it throws on provider errors, which propagate.
 */
export async function matchCatalog(clues, { selectedGame, search }) {
  const byId = new Map();
  for (const step of planQueries(clues, selectedGame)) {
    const cards = await search(step.query, step.game);
    for (const card of cards) {
      const key = `${step.game}:${card.id}`;
      if (byId.has(key)) continue;
      byId.set(key, {
        card: { ...card, game: card.game ?? step.game },
        game: step.game,
        ...scoreCandidate(card, clues),
      });
    }
  }
  // A card whose number matches but whose name contradicts the name read is
  // listed after the cards the name fits: a misread number is a real code of
  // another card, and must not push the card in hand down the list.
  const ranked = [...byId.values()]
    .filter((item) => item.score >= CANDIDATE_SCORE)
    .sort(
      (a, b) =>
        Number(a.nameConflict) - Number(b.nameConflict) ||
        (b.rank ?? b.score) - (a.rank ?? a.score) ||
        b.score - a.score,
    );
  if (!ranked.length)
    return {
      status: MATCH_STATUS.NOT_IDENTIFIED,
      candidates: [],
      searched: byId.size,
    };
  const [best, next] = ranked;
  // Prefer uncapped `rank` so a variant-label hit can clear the margin when
  // the capped `score` would otherwise tie every same-number printing at 1.
  const bestRank = best.rank ?? best.score;
  const nextRank = next ? (next.rank ?? next.score) : null;
  const clear =
    best.score >= IDENTIFIED_SCORE &&
    (nextRank === null || bestRank - nextRank >= IDENTIFIED_MARGIN);
  if (clear)
    return {
      status: MATCH_STATUS.IDENTIFIED,
      candidates: [best],
      searched: byId.size,
    };
  const cards = [...new Set(ranked.map(cardKey))];
  // Every card that matches the printed number stays listed, however many:
  // printings sharing a number can differ several hundredfold in value, and
  // the customer can only pick the one in hand if it is shown. Other cards
  // fill the remaining places.
  // A number match the name read contradicts earns no reserved place.
  const numbered = cards.filter((key) =>
    ranked.some(
      (item) => cardKey(item) === key && item.numberMatch && !item.nameConflict,
    ),
  );
  const shown = new Set([
    ...numbered,
    ...cards
      .filter((key) => !numbered.includes(key))
      .slice(0, Math.max(0, MAX_CANDIDATES - numbered.length)),
  ]);
  const first = (key) => ranked.find((item) => cardKey(item) === key);
  const topRank = (key) => first(key).rank ?? first(key).score;
  // A misread number can match a different real card exactly; when another
  // card fits the name read better, number and name disagree and neither
  // card is a lead.
  const nameDisagrees = cards
    .slice(1)
    .some((key) => first(key).nameScore > first(cards[0]).nameScore);
  // Cards match the number read, but no name read supports any of them: the
  // number is the only evidence, and a misread one names another card
  // (Primeape 043/084 read as 043/082 is Dark Primeape). The screen says so
  // and highlights nothing; a number the customer typed is their own evidence.
  const numberOnly =
    ranked.some((item) => item.numberMatch) &&
    ranked.every((item) => !item.numberMatch || item.nameScore === 0);
  return {
    status: MATCH_STATUS.NEEDS_CONFIRMATION,
    candidates: ranked.filter((item) => shown.has(cardKey(item))),
    searched: byId.size,
    // Matching cards left off the shortlist.
    moreCards: cards.length - shown.size,
    // The first card is only a lead when its evidence beats the next card's;
    // a tie (e.g. a name read with no number) has no lead to suggest.
    leader:
      !first(cards[0]).nameConflict &&
      !(numberOnly && !clues.corrected) &&
      (cards.length === 1 ||
        (topRank(cards[0]) > topRank(cards[1]) && !nameDisagrees)),
    // No candidate matched a printed number, so the name alone cannot tell
    // these cards apart: the card's number is the evidence still needed.
    // A number match the name contradicts does not count as the number.
    needsNumber:
      cards.length > 1 &&
      !ranked.some((item) => item.numberMatch && !item.nameConflict),
    // Every card matching the number read disagrees with the name read: the
    // number may be misread, so the customer is asked to check it.
    checkNumber:
      ranked.some((item) => item.numberMatch) &&
      ranked.every((item) => !item.numberMatch || item.nameConflict),
    numberOnly,
  };
}
