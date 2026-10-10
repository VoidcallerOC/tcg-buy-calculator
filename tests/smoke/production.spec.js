import { test, expect } from "@playwright/test";

// Live smoke test: real /api/cards (JustTCG), real Tesseract OCR, production
// headers. Expected offers are derived from the live reference price, so the
// test does not depend on today's market value.

function watchConsole(page) {
  const problems = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text()))
      problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  return problems;
}
const expectedOffer = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number((BigInt(cents) * 6000n + 5000n) / 10000n) / 100,
  );

async function liveReference(request, query) {
  const response = await request.get(
    `/api/cards?game=pokemon&q=${encodeURIComponent(query)}`,
  );
  expect(response.ok()).toBe(true);
  const body = await response.json();
  const card = body.cards.find((item) => item.card_number === "199/165");
  expect(card, "live catalog returns Charizard ex 199/165").toBeTruthy();
  return card;
}

test("manual search prices a live card at the 60% buy rate", async ({
  page,
  request,
}) => {
  const problems = watchConsole(page);
  const card = await liveReference(request, "199/165");
  await page.goto("/");
  await expect(page.getByLabel("Game")).toHaveValue("pokemon");
  await page.getByLabel("Card search").fill("199/165");
  await page
    .getByRole("button", { name: /Charizard ex.*199\/165/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#offer-value")).toHaveText(
    expectedOffer(card.pricing.NM.reference_cents),
  );
  await expect(page.locator("#rate-value")).toHaveText("60%");
  await expect(page.locator("#result-source")).toContainText("JustTCG");
  expect(problems).toEqual([]);
});

test("camera scan → real OCR → live match → confirmed card → offer", async ({
  page,
  request,
}) => {
  const problems = watchConsole(page);
  const card = await liveReference(request, "199/165");
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    const context = canvas.getContext("2d");
    const draw = () => {
      context.fillStyle = "#30302e";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const height = canvas.height * 0.62;
      const width = (height * 63) / 88;
      const x = (canvas.width - width) / 2;
      const y = (canvas.height - height) / 2;
      context.fillStyle = "#ffffff";
      context.fillRect(x, y, width, height);
      context.fillStyle = "#000000";
      context.font = "bold 44px Arial, sans-serif";
      context.fillText("Charizard ex", x + width * 0.08, y + height * 0.1);
      context.font = "bold 30px Arial, sans-serif";
      context.fillText("199/165", x + width * 0.06, y + height * 0.95);
    };
    draw();
    window.__tracks = [];
    const media = navigator.mediaDevices ?? {};
    media.getUserMedia = async () => {
      const stream = canvas.captureStream(15);
      window.__tracks.push(...stream.getTracks());
      setInterval(draw, 60);
      return stream;
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: media,
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Capture" }).click();
  const use = page.getByRole("button", { name: "Use this card" });
  await expect(use.first()).toBeVisible({ timeout: 150_000 });
  await expect(page.locator(".scanner-read")).toContainText("199/165");
  const candidate = page.locator(".scan-candidate", { hasText: "199/165" });
  await candidate
    .getByRole("button", { name: "Use this card" })
    .first()
    .click();
  await expect(page.locator("#scanner")).toBeHidden();
  expect(
    await page.evaluate(
      () => window.__tracks.filter((t) => t.readyState === "live").length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#offer-value")).toHaveText(
    expectedOffer(card.pricing.NM.reference_cents),
  );
  expect(problems).toEqual([]);
});

test("admin page loads its sign-in form without CSP errors", async ({
  page,
}) => {
  const problems = watchConsole(page);
  await page.goto("/admin/");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign in/ })).toBeVisible();
  await expect(page.locator("#login-message")).not.toContainText(
    "not configured",
  );
  expect(problems).toEqual([]);
});
