import { test, expect } from "@playwright/test";

// Prices are dated "now" so they are inside the freshness threshold.
const fresh = () => new Date().toISOString();

const cards = {
  "OP05-060": {
    id: "luffy",
    name: "Monkey.D.Luffy",
    card_number: "OP05-060",
    set_name: "Awakening of the New Era",
    pricing: { NM: { reference_cents: 1499, source_updated_at: fresh() } },
  },
  "OP17-001": {
    id: "dragon",
    name: "Monkey.D.Dragon",
    card_number: "OP17-001",
    set_name: "Heroines Edition",
    pricing: { NM: { reference_cents: 1000, source_updated_at: fresh() } },
  },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/cards?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    const card = Object.values(cards).find((candidate) =>
      `${candidate.name} ${candidate.card_number}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cards: card ? [card] : [] }),
    });
  });
});

test.describe("TCG buy calculator", () => {
  test("searches, selects, calculates, and shows a rounded estimate", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Card search").fill("OP05-060");
    await page
      .getByRole("button", { name: /Monkey\.D\.Luffy.*OP05-060/ })
      .click();
    await page.getByRole("button", { name: "Near Mint" }).click();
    await expect(
      page.getByRole("button", { name: /Calculate estimated offer/ }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: /Calculate estimated offer/ })
      .click();
    await expect(page.locator("#offer-value")).toHaveText("$8.99");
    await expect(page.locator("#reference-value")).toHaveText("$14.99");
    await expect(page.locator("#rate-value")).toHaveText("60%");
    await expect(page.locator("#result-ready")).toBeVisible();
  });

  test("does not invent an estimate when a condition has no pricing", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Card search").fill("OP17-001");
    await page
      .getByRole("button", { name: /Monkey\.D\.Dragon.*OP17-001/ })
      .click();
    await page.getByRole("button", { name: "Damaged" }).click();
    await page
      .getByRole("button", { name: /Calculate estimated offer/ })
      .click();
    await expect(page.locator("#result-unavailable")).toBeVisible();
    await expect(page.locator("#result-unavailable")).toContainText(
      "Online estimate unavailable",
    );
  });

  test("keeps the offer usable on a narrow mobile viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByLabel("Card search").fill("OP05-060");
    await page
      .getByRole("button", { name: /Monkey\.D\.Luffy.*OP05-060/ })
      .click();
    await page.getByRole("button", { name: "Near Mint" }).click();
    await page
      .getByRole("button", { name: /Calculate estimated offer/ })
      .click();
    await expect(page.locator("#result-ready")).toBeVisible();
    expect(
      await page.locator("body").evaluate((body) => body.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });

  test("ignores in-flight search results after the game changes", async ({
    page,
  }) => {
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    await page.unroute("**/api/cards?**");
    await page.route("**/api/cards?**", async (route) => {
      call += 1;
      if (call === 1) {
        await firstGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            cards: [
              {
                id: "stale",
                name: "Stale One Piece Hit",
                card_number: "OP05-060",
                set_name: "Stale Set",
                pricing: {
                  NM: { reference_cents: 1499, source_updated_at: fresh() },
                },
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cards: [
            {
              id: "fresh",
              name: "Fresh Pokemon Hit",
              card_number: "SV01-001",
              set_name: "Scarlet & Violet",
              pricing: {
                NM: { reference_cents: 500, source_updated_at: fresh() },
              },
            },
          ],
        }),
      });
    });

    await page.goto("/");
    const firstRequest = page.waitForRequest("**/api/cards?**");
    await page.getByLabel("Card search").fill("Hit");
    await firstRequest;
    await page.getByLabel("Game").selectOption("pokemon");
    releaseFirst();
    await expect(
      page.getByRole("button", { name: /Fresh Pokemon Hit/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Stale One Piece Hit/ }),
    ).toHaveCount(0);
  });
});

async function mockCards(page, handler) {
  await page.unroute("**/api/cards?**");
  await page.route("**/api/cards?**", handler);
}
const fulfillCards = (route, cards, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(status === 200 ? { cards } : { error: cards }),
  });

test.describe("pricing integrity", () => {
  test("distinguishes printings and prices each one separately", async ({
    page,
  }) => {
    const base = {
      name: "Monkey.D.Luffy",
      card_number: "OP05-119",
      set_name: "Awakening of the New Era",
    };
    await mockCards(page, (route) =>
      fulfillCards(route, [
        {
          ...base,
          id: "luffy::normal",
          printing: "Normal",
          language: "English",
          pricing: {
            NM: { reference_cents: 1000, source_updated_at: fresh() },
          },
        },
        {
          ...base,
          id: "luffy::foil",
          printing: "Foil",
          language: "English",
          pricing: {
            NM: { reference_cents: 5000, source_updated_at: fresh() },
          },
        },
      ]),
    );
    await page.goto("/");
    await page.getByLabel("Card search").fill("OP05-119");
    await expect(page.getByRole("button", { name: /Normal/ })).toBeVisible();
    await page.getByRole("button", { name: /Foil/ }).click();
    await expect(page.getByLabel("Card search")).toHaveValue(
      "Monkey.D.Luffy · OP05-119 · Foil",
    );
    await page.getByRole("button", { name: "Near Mint" }).click();
    await page
      .getByRole("button", { name: /Calculate estimated offer/ })
      .click();
    await expect(page.locator("#offer-value")).toHaveText("$30.00");
    await expect(page.locator("#result-card-label")).toContainText("Foil");
    await expect(page.locator("#result-source")).toContainText(
      "Market reference: JustTCG, updated",
    );
  });

  test("never estimates from an undated or stale price", async ({ page }) => {
    const stale = new Date(Date.now() - 30 * 86400000).toISOString();
    await mockCards(page, (route) =>
      fulfillCards(route, [
        {
          id: "undated",
          name: "Undated Card",
          card_number: "OP01-001",
          set_name: "Romance Dawn",
          pricing: { NM: { reference_cents: 1000 } },
        },
        {
          id: "stale",
          name: "Stale Card",
          card_number: "OP01-002",
          set_name: "Romance Dawn",
          pricing: { NM: { reference_cents: 1000, source_updated_at: stale } },
        },
      ]),
    );
    await page.goto("/");
    await page.getByLabel("Card search").fill("Card");
    await page.getByRole("button", { name: /Undated Card/ }).click();
    await page.getByRole("button", { name: "Near Mint" }).click();
    await page
      .getByRole("button", { name: /Calculate estimated offer/ })
      .click();
    await expect(page.locator("#result-unavailable")).toContainText(
      "has no date",
    );
    await expect(page.locator("#result-ready")).toBeHidden();

    await page.getByLabel("Card search").fill("Card");
    await page.getByRole("button", { name: /Stale Card/ }).click();
    await page.getByRole("button", { name: "Near Mint" }).click();
    await page
      .getByRole("button", { name: /Calculate estimated offer/ })
      .click();
    await expect(page.locator("#result-unavailable")).toContainText("stale");
    await expect(page.locator("#result-ready")).toBeHidden();
  });

  test("shows provider failures and empty results without stale cards", async ({
    page,
  }) => {
    let fail = false;
    await mockCards(page, (route) =>
      fail
        ? fulfillCards(route, "Live pricing provider is not configured.", 503)
        : fulfillCards(route, []),
    );
    await page.goto("/");
    await page.getByLabel("Card search").fill("Nothing here");
    await expect(page.locator("#search-message")).toContainText(
      "No matching cards found",
    );
    fail = true;
    await page.getByLabel("Card search").fill("Anything");
    await expect(page.locator("#search-message")).toHaveText(
      "Live pricing provider is not configured.",
    );
    await expect(page.locator(".search-result")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Calculate estimated offer/ }),
    ).toBeDisabled();
  });

  test("calculate stays disabled until both a card and condition are chosen", async ({
    page,
  }) => {
    await page.goto("/");
    const calculate = page.getByRole("button", {
      name: /Calculate estimated offer/,
    });
    await page.getByRole("button", { name: "Near Mint" }).click();
    await expect(calculate).toBeDisabled();
    await page.getByLabel("Card search").fill("OP05-060");
    await page
      .getByRole("button", { name: /Monkey\.D\.Luffy.*OP05-060/ })
      .click();
    await expect(calculate).toBeEnabled();
    await page.getByLabel("Game").selectOption("pokemon");
    await expect(calculate).toBeDisabled();
  });

  test("offers every supported game with provider ids when the list API is down", async ({
    page,
  }) => {
    await page.goto("/");
    const values = await page
      .locator("#game-select option")
      .evaluateAll((options) => options.map((option) => option.value));
    expect(values).toEqual([
      "pokemon",
      "one-piece-card-game",
      "magic-the-gathering",
      "yugioh",
      "disney-lorcana",
      "flesh-and-blood-tcg",
    ]);
  });

  test("works with the keyboard alone", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Card search").focus();
    await page.keyboard.type("OP05-060");
    const result = page.getByRole("button", {
      name: /Monkey\.D\.Luffy.*OP05-060/,
    });
    await expect(result).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(result).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(result).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Near Mint" }).focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: /Calculate estimated offer/ })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#offer-value")).toHaveText("$8.99");
  });
});
