import { test, expect } from "@playwright/test";

// Several cards in one visit: scan (stubbed scanner UI), price, add to the
// list, scan the next card. The list only copies offers the calculator showed.

const fresh = () => new Date().toISOString();
const stale = () => new Date(Date.now() - 30 * 86400000).toISOString();
const SCANNED = [
  {
    id: "charizard",
    game: "pokemon",
    name: "Charizard ex",
    card_number: "199/165",
    set_name: "Scarlet & Violet—151",
    pricing: { NM: { reference_cents: 20000, source_updated_at: fresh() } },
  },
  {
    id: "luffy",
    game: "one-piece-card-game",
    name: "Monkey.D.Luffy",
    card_number: "OP05-060",
    set_name: "Awakening of the New Era",
    pricing: { NM: { reference_cents: 1499, source_updated_at: fresh() } },
  },
  {
    id: "old",
    game: "pokemon",
    name: "Pikachu",
    card_number: "025/165",
    set_name: "Scarlet & Violet—151",
    pricing: { NM: { reference_cents: 500, source_updated_at: stale() } },
  },
];

async function stubScanner(page) {
  // Each tap of a scan button confirms the next card in SCANNED.
  await page.route("**/scanner/scanner-ui.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        const cards = ${JSON.stringify(SCANNED)};
        let next = 0;
        export function openScanner({ onConfirm, returnFocus }) {
          onConfirm(cards[next++ % cards.length]);
          returnFocus?.focus();
        }
      `,
    }),
  );
}

async function priceAndAdd(page, expectedOffer) {
  await page.getByRole("button", { name: "Near Mint", exact: true }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  if (expectedOffer)
    await expect(page.locator("#offer-value")).toHaveText(expectedOffer);
  await page.locator("#add-to-list").click();
}

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
]) {
  test(`scan several cards into one list with a running total (${viewport.name})`, async ({
    page,
  }) => {
    const requests = [];
    page.on("request", (request) =>
      requests.push(`${request.method()} ${request.url()}`),
    );
    await stubScanner(page);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#card-list")).toBeHidden();
    await expect(page.locator("#add-to-list")).toBeHidden();

    await page.getByRole("button", { name: /Scan a card/ }).click();
    await priceAndAdd(page, "$120.00");
    await expect(page.locator("#card-list")).toBeVisible();
    await expect(page.locator("#card-list-total")).toHaveText("$120.00");
    await expect(page.locator("#search-message")).toHaveText(
      "Added Charizard ex · 199/165. Scan or search the next card.",
    );
    // Back to step 1: nothing selected, nothing priced on screen.
    await expect(page.getByLabel("Card search")).toHaveValue("");
    await expect(page.locator("#add-to-list")).toBeHidden();
    await expect(page.locator("#result-empty")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Scan next card" }),
    ).toBeFocused();

    await page.getByRole("button", { name: "Scan next card" }).click();
    await expect(page.getByLabel("Game")).toHaveValue("one-piece-card-game");
    await priceAndAdd(page, "$8.99");
    await expect(page.locator("#card-list-count")).toHaveText("2 cards");
    await expect(page.locator("#card-list-total")).toHaveText("$128.99");

    // A stale price is listed for in-store pricing, never totalled.
    await page.getByRole("button", { name: "Scan next card" }).click();
    await page.getByRole("button", { name: "Near Mint", exact: true }).click();
    await page
      .getByRole("button", { name: /Calculate estimated offer/ })
      .click();
    await expect(page.locator("#result-unavailable")).toBeVisible();
    await expect(page.locator("#add-to-list")).toHaveText(
      "Add to my list without an estimate",
    );
    await page.locator("#add-to-list").click();
    await expect(page.locator("#card-list-count")).toHaveText("3 cards");
    await expect(page.locator("#card-list-total")).toHaveText("$128.99");
    await expect(page.locator(".card-list-item").nth(2)).toContainText(
      "In store",
    );
    await expect(page.locator("#card-list-note")).toContainText(
      "1 card has no online estimate and is not in the total",
    );

    await page
      .getByRole("button", { name: /Remove Charizard ex · 199\/165/ })
      .click();
    await expect(page.locator("#card-list-count")).toHaveText("2 cards");
    await expect(page.locator("#card-list-total")).toHaveText("$8.99");

    expect(
      await page.locator("body").evaluate((body) => body.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Clear list" }).click();
    await expect(page.locator("#card-list")).toBeHidden();

    // Public flow: only reads; no writes and no database/admin calls.
    expect(requests.filter((entry) => !entry.startsWith("GET "))).toEqual([]);
    expect(
      requests.filter((entry) =>
        /supabase|\/admin|\/rest\/v1|\/rpc\//.test(entry),
      ),
    ).toEqual([]);
  });
}

test("dismissing Clear list keeps every card", async ({ page }) => {
  await stubScanner(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await priceAndAdd(page, "$120.00");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Clear list" }).click();
  await expect(page.locator("#card-list-count")).toHaveText("1 card");
});

test("changing condition after pricing withdraws the stale Add button", async ({
  page,
}) => {
  await stubScanner(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Near Mint", exact: true }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#add-to-list")).toBeVisible();
  await page
    .getByRole("button", { name: "Lightly Played", exact: true })
    .click();
  await expect(page.locator("#add-to-list")).toBeHidden();
});
