// CatalogMatcher: searches the calculator's existing catalog (live API or the
// labeled demo catalog, via the injected `search`) with the clues a scan
// produced, scores what comes back, and decides how sure we are. It never
// auto-selects: even IDENTIFIED is shown to the customer for confirmation.

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
export function nameSimilarity(a, b) {
  const left = tokens(a),
    right = tokens(b);
  if (!left.length || !right.length) return 0;
  const pool = [...right];
  let shared = 0;
  for (const token of left) {
    const index = pool.findIndex(
      (other) =>
        other === token ||
        (token.length > 3 &&
          other.length > 3 &&
          (other.startsWith(token) || token.startsWith(other))),
    );
    if (index >= 0) {
      shared += 1;
      pool.splice(index, 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

export function scoreCandidate(card, clues) {
  const number = normalizeNumber(card.card_number);
  const numberMatch = clues.identifiers.some(
    (item) => normalizeNumber(item.query) === number,
  );
  const nameScore = Math.max(
    0,
    ...clues.names.map((name) => nameSimilarity(name, card.name)),
  );
  const setMatch = clues.setCodes.some(
    (code) => code.toUpperCase() === String(card.set_code ?? "").toUpperCase(),
  );
  let score = (numberMatch ? 0.6 : 0) + nameScore * 0.4 + (setMatch ? 0.1 : 0);
  if (!clues.identifiers.length) score = nameScore * 0.8; // name-only reads cap below IDENTIFIED
  // A number was read and this card's number differs: show the conflict
  // instead of letting a name match quietly stand in for the card.
  const readNumbers = clues.identifiers
    .filter((item) => item.query)
    .map((item) => item.raw ?? item.query);
  const numberConflict =
    !numberMatch && readNumbers.length > 0 && Boolean(card.card_number);
  return {
    score: Math.min(1, Number(score.toFixed(3))),
    numberMatch,
    numberConflict,
    readNumbers: numberConflict ? readNumbers : [],
    nameScore: Number(nameScore.toFixed(3)),
    setMatch,
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
export function planQueries(clues, selectedGame) {
  const games = [selectedGame, ...clues.identifiers.map((item) => item.game)]
    .filter((game, index, all) => game && all.indexOf(game) === index)
    .slice(0, 2);
  const plan = [];
  for (const item of clues.identifiers)
    if (games.includes(item.game))
      plan.push({ game: item.game, query: item.query });
  for (const name of clues.names.slice(0, 2))
    for (const game of games) plan.push({ game, query: name });
  return plan
    .filter(
      (step, index, all) =>
        all.findIndex(
          (other) => other.game === step.game && other.query === step.query,
        ) === index,
    )
    .slice(0, MAX_QUERIES);
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
  const ranked = [...byId.values()]
    .filter((item) => item.score >= CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length)
    return {
      status: MATCH_STATUS.NOT_IDENTIFIED,
      candidates: [],
      searched: byId.size,
    };
  const [best, next] = ranked;
  const clear =
    best.score >= IDENTIFIED_SCORE &&
    (!next || best.score - next.score >= IDENTIFIED_MARGIN);
  if (clear)
    return {
      status: MATCH_STATUS.IDENTIFIED,
      candidates: [best],
      searched: byId.size,
    };
  const cards = [...new Set(ranked.map(cardKey))];
  const shown = new Set(cards.slice(0, MAX_CANDIDATES));
  const first = (key) => ranked.find((item) => cardKey(item) === key);
  const topScore = (key) => first(key).score;
  // A misread number can match a different real card exactly; when another
  // card fits the name read better, number and name disagree and neither
  // card is a lead.
  const nameDisagrees = cards
    .slice(1)
    .some((key) => first(key).nameScore > first(cards[0]).nameScore);
  return {
    status: MATCH_STATUS.NEEDS_CONFIRMATION,
    candidates: ranked.filter((item) => shown.has(cardKey(item))),
    searched: byId.size,
    // Matching cards left off the shortlist.
    moreCards: cards.length - shown.size,
    // The first card is only a lead when its evidence beats the next card's;
    // a tie (e.g. a name read with no number) has no lead to suggest.
    leader:
      cards.length === 1 ||
      (topScore(cards[0]) > topScore(cards[1]) && !nameDisagrees),
    // No candidate matched a printed number, so the name alone cannot tell
    // these cards apart: the card's number is the evidence still needed.
    needsNumber: cards.length > 1 && !ranked.some((item) => item.numberMatch),
  };
}
