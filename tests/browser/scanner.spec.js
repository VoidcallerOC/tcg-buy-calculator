import { test, expect } from "@playwright/test";

const cards = {
  "OP05-060": {
    id: "luffy",
    name: "Monkey.D.Luffy",
    card_number: "OP05-060",
    set_name: "Awakening of the New Era",
    pricing: { NM: { reference_cents: 1499 } },
  },
  "199/165": {
    id: "charizard",
    name: "Charizard ex",
    card_number: "199/165",
    set_name: "Scarlet & Violet—151",
    pricing: { NM: { reference_cents: 20000 } },
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const media = navigator.mediaDevices ?? {};
    media.getUserMedia = async () => {
      const error = new Error("Permission denied");
      error.name = "NotAllowedError";
      throw error;
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: media,
    });
  });

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

test.describe("Dragon's Lair scanner integration", () => {
  test("Scan a card opens the camera dialog", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Scan a card/ }).click();
    await expect(page.locator("#scanner")).toBeVisible();
    await expect(page.locator("#scanner-heading")).toHaveText("Scan a card");
  });

  test("camera denial shows an honest error and Search manually closes the dialog", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Scan a card/ }).click();
    await expect(page.getByText(/Camera access is blocked/i)).toBeVisible();
    await page.getByRole("button", { name: /Search manually/i }).click();
    await expect(page.locator("#scanner")).toBeHidden();
    await expect(page.getByLabel("Card search")).toBeFocused();
  });

  test("manual search path still calculates at 60% with the scan CTA present", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /Scan a card/ }),
    ).toBeVisible();
    await page.getByLabel("Card search").fill("OP05-060");
    await page
      .getByRole("button", { name: /Monkey\.D\.Luffy.*OP05-060/ })
      .click();
    await page.getByRole("button", { name: "Near Mint" }).click();
    await page
      .getByRole("button", { name: /Calculate estimated offer/ })
      .click();
    await expect(page.locator("#offer-value")).toHaveText("$8.99");
    await expect(page.locator("#rate-value")).toHaveText("60%");
  });

  test("scanner overlay fits a narrow mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: /Scan a card/ }).click();
    await expect(page.locator("#scanner")).toBeVisible();
    const box = await page.locator("#scanner").boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    expect(
      await page.locator("body").evaluate((body) => body.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });

  test("confirming a scanned card reuses the existing offer path at 60%", async ({
    page,
  }) => {
    // Stub the Dragon's Lair scanner UI so openScanner immediately confirms a card
    // through app.js confirmScannedCard — no real camera/OCR in CI.
    await page.route("**/scanner/scanner-ui.js", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `
          export function openScanner({ onConfirm, returnFocus }) {
            onConfirm({
              id: "charizard",
              game: "pokemon",
              name: "Charizard ex",
              card_number: "199/165",
              set_name: "Scarlet & Violet—151",
              pricing: { NM: { reference_cents: 20000 } },
            });
            returnFocus?.focus();
          }
        `,
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: /Scan a card/ }).click();
    await expect(
      page.getByText(/Card confirmed from your scan/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Charizard ex.*199\/165/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Near Mint" }).click();
    await page
      .getByRole("button", { name: /Calculate estimated offer/ })
      .click();
    await expect(page.locator("#offer-value")).toHaveText("$120.00");
    await expect(page.locator("#reference-value")).toHaveText("$200.00");
    await expect(page.locator("#rate-value")).toHaveText("60%");
  });
});
