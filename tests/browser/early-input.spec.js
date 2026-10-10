import { test, expect } from "@playwright/test";

// A cold /api/games (first request after a deploy) must not swallow what the
// customer types or picks before the game list arrives.

const card = {
  id: "luffy",
  name: "Monkey.D.Luffy",
  card_number: "OP05-060",
  set_name: "Awakening of the New Era",
  pricing: {
    NM: { reference_cents: 1499, source_updated_at: new Date().toISOString() },
  },
};

const liveGames = {
  games: [
    { provider_game_id: "cyberpunk-tcg", name: "Cyberpunk TCG" },
    { provider_game_id: "one-piece-card-game", name: "One Piece Card Game" },
    { provider_game_id: "pokemon", name: "Pokemon" },
    { provider_game_id: "yugioh", name: "YuGiOh" },
  ],
};

// Holds /api/games until release() is called (or 2 s pass).
function delayGames(page) {
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  const fulfilled = page.route("**/api/games", async (route) => {
    await Promise.race([
      released,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(liveGames),
    });
  });
  return { fulfilled, release: () => release() };
}

// Opens the page and returns once /api/games is in flight, i.e. while the
// game list is still loading.
async function openWhileGamesLoad(page) {
  const gamesRequested = page.waitForRequest("**/api/games");
  await page.goto("/", { waitUntil: "commit" });
  await gamesRequested;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/cards?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cards: [card] }),
    }),
  );
});

test("a search typed before a slow game list loads still runs", async ({
  page,
}) => {
  const games = delayGames(page);
  await games.fulfilled;
  const cardsRequest = page.waitForRequest("**/api/cards?**", {
    timeout: 1500,
  });
  await openWhileGamesLoad(page);
  await page.getByLabel("Card search").fill("OP05-060");
  // Sent within the 2 s the game list is held, so it did not wait for it.
  const request = await cardsRequest;
  expect(new URL(request.url()).searchParams.get("game")).toBe("pokemon");
  await expect(
    page.getByRole("button", { name: /Monkey\.D\.Luffy.*OP05-060/ }),
  ).toBeVisible();
  // The live list still merges in afterwards, featured games first.
  await expect(page.locator("#game-select option")).toHaveCount(4, {
    timeout: 5000,
  });
  await expect(page.getByLabel("Game")).toHaveValue("pokemon");
});

test("a card picked before the game list loads stays selected", async ({
  page,
}) => {
  const games = delayGames(page);
  await games.fulfilled;
  await openWhileGamesLoad(page);
  await page.getByLabel("Game").selectOption("one-piece-card-game");
  await page.getByLabel("Card search").fill("OP05-060");
  const result = page.getByRole("button", {
    name: /Monkey\.D\.Luffy.*OP05-060/,
  });
  await result.click();
  await page.getByRole("button", { name: "Near Mint" }).click();
  games.release();
  await expect(page.locator("#game-select option")).toHaveCount(4);
  // Same game after the merge, so the pick, condition and query survive.
  await expect(page.getByLabel("Game")).toHaveValue("one-piece-card-game");
  await expect(result).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#offer-value")).toHaveText("$8.99");
});

test("a game dropped from the live list resets the selection", async ({
  page,
}) => {
  const games = delayGames(page);
  await games.fulfilled;
  await openWhileGamesLoad(page);
  // Disney Lorcana is featured but missing from the live list above.
  await page.getByLabel("Game").selectOption("disney-lorcana");
  await page.getByLabel("Card search").fill("OP05-060");
  await page
    .getByRole("button", { name: /Monkey\.D\.Luffy.*OP05-060/ })
    .click();
  const searches = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/cards?")) searches.push(request.url());
  });
  games.release();
  await expect(page.getByLabel("Game")).toHaveValue("pokemon");
  // The old pick is cleared and the query reruns for the game now selected.
  await expect
    .poll(() => searches.map((url) => new URL(url).searchParams.get("game")))
    .toEqual(["pokemon"]);
  await expect(
    page.getByRole("button", { name: /Calculate estimated offer/ }),
  ).toBeDisabled();
});
