import { test, expect } from "@playwright/test";

const cards = {
  "OP05-060": {
    id: "luffy",
    name: "Monkey.D.Luffy",
    card_number: "OP05-060",
    set_name: "Awakening of the New Era",
    pricing: { NM: { reference_cents: 1499 } },
  },
  "OP17-001": {
    id: "dragon",
    name: "Monkey.D.Dragon",
    card_number: "OP17-001",
    set_name: "Heroines Edition",
    pricing: { NM: { reference_cents: 1000 } },
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
});
