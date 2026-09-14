import { test, expect } from "@playwright/test";

test.describe("TCG buy calculator", () => {
  test("searches a card, selects condition, and shows a rounded estimate", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Card search").fill("OP05-060");
    await page
      .getByRole("button", { name: /Monkey\.D\.Luffy.*OP05-060/ })
      .click();
    await page.getByRole("button", { name: "Near Mint" }).click();
    await expect(page.locator("#offer-value")).toHaveText("$8.99");
    await expect(page.locator("#reference-value")).toHaveText("$14.99");
    await expect(page.locator("#rate-value")).toHaveText("60%");
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
    await expect(page.locator("#result-unavailable")).toBeVisible();
    await expect(page.locator("#result-unavailable")).toContainText(
      "Online estimate unavailable",
    );
  });
});
