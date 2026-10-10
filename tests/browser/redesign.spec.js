import { test, expect } from "@playwright/test";

// Workstation redesign: selection flow, condition hints, disabled-state help,
// and responsive layout. The card API is mocked; calculations use the real
// app.js / lib/money.js path.
const fresh = () => new Date().toISOString();
const stale = () => new Date(Date.now() - 30 * 86400000).toISOString();
const card = (id, name, number, pricing) => ({
  id,
  name,
  card_number: number,
  set_name: "Test Set",
  pricing,
});
const results = [
  card("a", "Alpha Dragon", "001/100", {
    NM: { reference_cents: 1000, source_updated_at: fresh() },
    LP: { reference_cents: 800, source_updated_at: stale() },
    MP: { reference_cents: 600 },
  }),
  card("b", "Beta Dragon", "002/100", {
    NM: { reference_cents: 2000, source_updated_at: fresh() },
  }),
  card("c", "Gamma Dragon", "003/100", {
    NM: { reference_cents: 3000, source_updated_at: fresh() },
  }),
];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/cards?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cards: results }),
    }),
  );
});

test("the client name appears once in the header", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".topbar")).toHaveText(/TCG Buy Calculator/);
  expect(
    (await page.locator(".topbar").innerText()).match(/TCG Buy Calculator/gi),
  ).toHaveLength(1);
});

test("selecting a card collapses the list and the toggle restores it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Card search").fill("Dragon");
  await expect(page.locator(".search-result")).toHaveCount(3);
  await page.getByRole("button", { name: /Beta Dragon/ }).click();
  await expect(page.locator(".search-result:visible")).toHaveCount(1);
  const toggle = page.getByRole("button", { name: "Show all 3 matches" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.locator(".search-result:visible")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Hide other matches" }),
  ).toHaveAttribute("aria-expanded", "true");
  // Picking a different card keeps the calculation path intact.
  await page.getByRole("button", { name: /Gamma Dragon/ }).click();
  await page.getByRole("button", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#offer-value")).toHaveText("$18.00");
  // Editing the query drops the pick and shows the list again.
  await page.getByLabel("Card search").fill("Drago");
  await expect(page.locator(".search-result.is-selected")).toHaveCount(0);
  await expect(page.locator("#results-toggle")).toBeHidden();
});

test("conditions without a usable online price are marked before calculating", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Card search").fill("Alpha");
  await page.getByRole("button", { name: /Alpha Dragon/ }).click();
  const option = (name) => page.locator(".condition-option", { hasText: name });
  await expect(option("Near Mint").locator(".condition-note")).toHaveText("");
  await expect(option("Lightly Played")).toContainText("Price out of date");
  await expect(option("Moderately Played")).toContainText("Price undated");
  await expect(option("Damaged")).toContainText("No online price");
  // The marker is informational: Calculate still explains the refusal.
  await option("Damaged").click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#result-unavailable")).toContainText(
    "pricing unavailable for this condition",
  );
  // Changing game clears the selected card and its markers.
  await page.getByLabel("Game").selectOption("yugioh");
  await expect(page.locator(".condition-note:not(:empty)")).toHaveCount(0);
});

test("the disabled Calculate button says what is missing", async ({ page }) => {
  await page.goto("/");
  const hint = page.locator("#calculate-hint");
  const calculate = page.getByRole("button", {
    name: /Calculate estimated offer/,
  });
  await expect(calculate).toBeDisabled();
  await expect(hint).toHaveText("Select a card and a condition to calculate.");
  await page.getByRole("button", { name: "Near Mint" }).click();
  await expect(hint).toHaveText("Select a card to calculate.");
  await page.getByLabel("Card search").fill("Beta");
  await page.getByRole("button", { name: /Beta Dragon/ }).click();
  await expect(hint).toHaveText("");
  await expect(calculate).toBeEnabled();
  await page.getByLabel("Game").selectOption("yugioh");
  await expect(hint).toHaveText("Select a card and a condition to calculate.");
});

test("a scan confirmed while a search is in flight can still be calculated", async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.unroute("**/api/cards?**");
  await page.route("**/api/cards?**", async (route) => {
    await gate;
    await route.fulfill({ status: 200, body: '{"cards":[]}' });
  });
  await page.route("**/scanner/scanner-ui.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `export function openScanner({ onConfirm }) {
        onConfirm({ id: "x", game: "pokemon", name: "Scanned Card",
          card_number: "010/100", set_name: "Test Set",
          pricing: { NM: { reference_cents: 500, source_updated_at: new Date().toISOString() } } });
      }`,
    }),
  );
  await page.goto("/");
  const pending = page.waitForRequest("**/api/cards?**");
  await page.getByLabel("Card search").fill("Something");
  await pending;
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Near Mint" }).click();
  const calculate = page.getByRole("button", {
    name: /Calculate estimated offer/,
  });
  await expect(calculate).toBeEnabled();
  await calculate.click();
  await expect(page.locator("#offer-value")).toHaveText("$3.00");
  release();
  await expect(page.locator("#offer-value")).toHaveText("$3.00");
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`no horizontal overflow at ${width}px with results and an offer`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByLabel("Card search").fill("Dragon");
    await page.getByRole("button", { name: /Alpha Dragon/ }).click();
    await page.getByRole("button", { name: "Near Mint" }).click();
    await page
      .getByRole("button", { name: /Calculate estimated offer/ })
      .click();
    await expect(page.locator("#result-ready")).toBeVisible();
    await expect(page.locator("#offer-value")).toHaveText("$6.00");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const offer = await page.locator("#offer-value").boundingBox();
    expect(offer.x + offer.width).toBeLessThanOrEqual(width);
  });
}

test("admin page fits a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/admin/");
  await expect(page.getByLabel("Email")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});
