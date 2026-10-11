import { test, expect } from "@playwright/test";

// End-to-end scan with a fake camera: a canvas stream shows a printed card,
// and the real self-hosted Tesseract.js worker, WASM core, and language data
// run under the production Content-Security-Policy from vercel.json. Only the
// card API is mocked.

test.describe.configure({ timeout: 180_000 });

const fresh = () => new Date().toISOString();
const charizard = {
  name: "Charizard ex",
  card_number: "199/165",
  set_name: "SV: Scarlet & Violet 151",
  rarity: "Special Illustration Rare",
  game: "pokemon",
};

async function fakeCamera(page, { lines, delayMs = 0 }) {
  await page.addInitScript(
    ({ cardLines, delayMs }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 1280;
      const context = canvas.getContext("2d");
      const draw = () => {
        context.fillStyle = "#30302e";
        context.fillRect(0, 0, canvas.width, canvas.height);
        // A card centred like the on-screen guide (63:88).
        const height = canvas.height * 0.62;
        const width = (height * 63) / 88;
        const x = (canvas.width - width) / 2;
        const y = (canvas.height - height) / 2;
        context.fillStyle = "#ffffff";
        context.fillRect(x, y, width, height);
        context.fillStyle = "#000000";
        for (const line of cardLines) {
          context.font = `bold ${line.size}px Arial, sans-serif`;
          context.fillText(line.text, x + width * line.x, y + height * line.y);
        }
      };
      draw();
      window.__cameraStarts = 0;
      window.__liveTracks = () =>
        window.__tracks.filter((track) => track.readyState === "live").length;
      window.__tracks = [];
      const media = navigator.mediaDevices ?? {};
      media.getUserMedia = async () => {
        window.__cameraStarts += 1;
        // Simulates the permission prompt / camera warm-up.
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const stream = canvas.captureStream(15);
        window.__tracks.push(...stream.getTracks());
        setInterval(draw, 60);
        return stream;
      };
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: media,
      });
    },
    { cardLines: lines, delayMs },
  );
}

test("scan → real OCR → confirm printing → calculator offer at 60%", async ({
  page,
}) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const searches = [];
  await page.route("**/api/cards?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    searches.push(`${params.get("game")}:${params.get("q")}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cards: [
          {
            ...charizard,
            id: "charizard::holofoil",
            printing: "Holofoil",
            language: "English",
            pricing: {
              NM: { reference_cents: 20000, source_updated_at: fresh() },
            },
          },
          {
            ...charizard,
            id: "charizard::reverse-holofoil",
            printing: "Reverse Holofoil",
            language: "English",
            pricing: {
              NM: { reference_cents: 15000, source_updated_at: fresh() },
            },
          },
        ],
      }),
    });
  });
  await fakeCamera(page, {
    lines: [
      { text: "Charizard ex", size: 44, x: 0.08, y: 0.1 },
      { text: "199/165", size: 30, x: 0.06, y: 0.95 },
    ],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const scanButton = page.getByRole("button", { name: /Scan a card/ });
  await scanButton.click();
  await expect(page.locator("#scanner")).toBeVisible();
  await expect(page.locator("#scanner-close, [data-scan-close]")).toBeFocused();
  await page.getByRole("button", { name: "Capture" }).click();

  // Two printings share name and number: the customer must choose.
  await expect(page.getByText("Needs confirmation")).toBeVisible({
    timeout: 150_000,
  });
  await expect(page.locator(".scanner-read")).toContainText("199/165");
  expect(searches.some((entry) => entry.startsWith("pokemon:"))).toBe(true);
  await expect(page.locator(".scan-candidate")).toHaveCount(2);
  await page
    .locator(".scan-candidate", { hasText: "Reverse Holofoil" })
    .getByRole("button", { name: "Use this card" })
    .click();

  await expect(page.locator("#scanner")).toBeHidden();
  expect(await page.evaluate(() => window.__liveTracks())).toBe(0);
  await expect(page.locator("#search-message")).toHaveText(
    "Card confirmed from your scan. Choose a condition below.",
  );
  await expect(page.getByLabel("Card search")).toHaveValue(
    "Charizard ex · 199/165 · Reverse Holofoil",
  );
  await page.getByRole("button", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#offer-value")).toHaveText("$90.00");
  await expect(page.locator("#reference-value")).toHaveText("$150.00");
  await expect(page.locator("#rate-value")).toHaveText("60%");
  expect(
    errors.filter((text) => /Content Security Policy|Refused/i.test(text)),
  ).toEqual([]);
});

test("unreadable card → not identified, manual fallback, camera released", async ({
  page,
}) => {
  let searched = false;
  await page.route("**/api/cards?**", async (route) => {
    searched = true;
    await route.fulfill({ status: 200, body: '{"cards":[]}' });
  });
  await fakeCamera(page, { lines: [] });
  await page.goto("/");
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText("We couldn’t read the card.")).toBeVisible({
    timeout: 150_000,
  });
  expect(searched).toBe(false);
  await page.getByRole("button", { name: "Search manually" }).click();
  await expect(page.locator("#scanner")).toBeHidden();
  await expect(page.getByLabel("Card search")).toBeFocused();
  expect(await page.evaluate(() => window.__liveTracks())).toBe(0);
});

test("repeated open/close and Escape release the camera and restore focus", async ({
  page,
}) => {
  await fakeCamera(page, { lines: [], delayMs: 400 });
  await page.goto("/");
  const scanButton = page.getByRole("button", { name: /Scan a card/ });
  for (let round = 0; round < 3; round += 1) {
    await scanButton.click();
    await expect(page.getByRole("button", { name: "Capture" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#scanner")).toBeHidden();
    await expect(scanButton).toBeFocused();
  }
  // Close while the camera is still starting (permission prompt open).
  await scanButton.click();
  await expect(page.locator("#scanner")).toBeVisible();
  await expect(page.getByText("Starting camera…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#scanner")).toBeHidden();
  await page.waitForTimeout(800);
  await expect(page.locator("#scanner")).toBeHidden();
  expect(await page.evaluate(() => window.__liveTracks())).toBe(0);
  expect(await page.evaluate(() => window.__cameraStarts)).toBeGreaterThan(3);
});

test("Tab focus stays inside the scanner dialog", async ({ page }) => {
  await fakeCamera(page, { lines: [] });
  await page.goto("/");
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await expect(page.getByRole("button", { name: "Capture" })).toBeVisible();
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        document.querySelector("#scanner").contains(document.activeElement),
      ),
    ).toBe(true);
  }
});

test("misread card → correct the number → catalog match → list → scan next", async ({
  page,
}) => {
  const searches = [];
  await page.route("**/api/cards?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const query = params.get("q") ?? "";
    searches.push(`${params.get("game")}:${query}`);
    const found = query === "199/165" || /charizard/i.test(query);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cards: found
          ? [
              {
                ...charizard,
                id: "charizard",
                pricing: {
                  NM: { reference_cents: 20000, source_updated_at: fresh() },
                },
              },
            ]
          : [],
      }),
    });
  });
  // A name the catalog does not know and no readable collector number.
  await fakeCamera(page, {
    lines: [{ text: "Zqxvbn wkj", size: 44, x: 0.08, y: 0.1 }],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText("Could not identify")).toBeVisible({
    timeout: 150_000,
  });
  // Not identified: the correction form is already open.
  const number = page.getByLabel("Card number");
  await expect(number).toBeVisible();
  await page.getByLabel("Card name").fill("");
  await number.fill("199/165");
  await page.getByRole("button", { name: "Search again" }).click();
  // A number alone never auto-identifies: the customer confirms the match.
  await expect(page.getByText("Needs confirmation")).toBeVisible();
  await expect(page.locator(".scanner-read")).toHaveText(
    "You entered: 199/165",
  );
  expect(searches).toContain("pokemon:199/165");
  await page.getByRole("button", { name: "Use this card" }).click();
  await expect(page.locator("#scanner")).toBeHidden();
  expect(await page.evaluate(() => window.__liveTracks())).toBe(0);

  await page.locator('.condition-option[data-code="NM"]').click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#offer-value")).toHaveText("$120.00");
  await page.locator("#add-to-list").click();
  await expect(page.locator("#card-list-total")).toHaveText("$120.00");

  // The next card starts a fresh camera session from the list.
  await page.getByRole("button", { name: "Scan next card" }).click();
  await expect(page.getByRole("button", { name: "Capture" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Scan next card" }),
  ).toBeFocused();
  expect(await page.evaluate(() => window.__liveTracks())).toBe(0);
});

// AI fallback: /api/identify is mocked (no model call in tests). Real OCR
// fails on a blank card first, then the customer asks for AI.
test("unreadable card → Identify with AI → catalog match → confirmed offer", async ({
  page,
}) => {
  const posts = [];
  await page.route("**/api/identify", async (route) => {
    const request = route.request();
    if (request.method() === "GET")
      return route.fulfill({ status: 200, body: '{"enabled":true}' });
    posts.push(request.postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        card: { name: "Charizard ex", number: "199/165", game: "pokemon" },
      }),
    });
  });
  const searches = [];
  await page.route("**/api/cards?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    searches.push(`${params.get("game")}:${params.get("q")}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cards: [
          {
            ...charizard,
            id: "charizard::holofoil",
            printing: "Holofoil",
            language: "English",
            pricing: {
              NM: { reference_cents: 20000, source_updated_at: fresh() },
            },
          },
        ],
      }),
    });
  });
  await fakeCamera(page, { lines: [] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText("We couldn’t read the card.")).toBeVisible({
    timeout: 150_000,
  });
  expect(posts).toHaveLength(0);
  await expect(page.locator(".scanner-ai-note")).toContainText(
    "Sends this card photo",
  );
  await page.getByRole("button", { name: "Identify with AI" }).click();
  await expect(page.locator(".scanner-read")).toContainText(
    "Read by AI (not verified)",
  );
  expect(posts).toHaveLength(1);
  expect(posts[0].game).toBe("pokemon");
  expect(posts[0].image).toMatch(/^[A-Za-z0-9+/]+=*$/);
  // A JPEG starts with FF D8 (base64 "/9j/").
  expect(posts[0].image.startsWith("/9j/")).toBe(true);
  expect(searches).toContain("pokemon:199/165");
  await expect(
    page.getByRole("button", { name: "Identify with AI" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Use this card" }).first().click();
  await expect(page.locator("#scanner")).toBeHidden();
  expect(await page.evaluate(() => window.__liveTracks())).toBe(0);
  await page.getByRole("button", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#offer-value")).toHaveText("$120.00");
});

test("no AI button when the server has no model key; AI errors keep manual paths", async ({
  page,
}) => {
  let enabled = false;
  await page.route("**/api/identify", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, body: JSON.stringify({ enabled }) })
      : route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"AI identification is busy. Try again shortly."}',
        }),
  );
  await page.route("**/api/cards?**", (route) =>
    route.fulfill({ status: 200, body: '{"cards":[]}' }),
  );
  await fakeCamera(page, { lines: [] });
  await page.goto("/");
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText("We couldn’t read the card.")).toBeVisible({
    timeout: 150_000,
  });
  await expect(
    page.getByRole("button", { name: "Identify with AI" }),
  ).toHaveCount(0);

  // Same flow with AI configured but failing: the error is shown and the
  // correction form and manual search remain.
  enabled = true;
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Capture" }).click();
  await page.getByRole("button", { name: "Identify with AI" }).click();
  await expect(page.locator(".scanner-ai .scanner-read")).toHaveText(
    "AI identification failed: AI identification is busy. Try again shortly.",
  );
  await expect(
    page.getByRole("button", { name: "Search manually" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search again" }),
  ).toBeAttached();
});

test("name read without a number: no set is implied, the number is asked for, then decides", async ({
  page,
}) => {
  // Six Primeape cards with two printings each, listed as the provider lists
  // sets (alphabetically, so Aquapolis comes first).
  const sets = [
    ["aquapolis", "Aquapolis", "029/147", ["Normal", "Reverse Holofoil"]],
    [
      "frlg",
      "EX FireRed & LeafGreen",
      "28/112",
      ["Normal", "Reverse Holofoil"],
    ],
    ["ge", "Great Encounters", "27/106", ["Normal", "Reverse Holofoil"]],
    ["jungle", "Jungle", "43/64", ["1st Edition", "Unlimited"]],
    [
      "legendary",
      "Legendary Collection",
      "059/110",
      ["Normal", "Reverse Holofoil"],
    ],
    [
      "sv151",
      "SV: Scarlet & Violet 151",
      "057/165",
      ["Normal", "Reverse Holofoil"],
    ],
  ];
  const cards = sets.flatMap(([key, set_name, card_number, printings], s) =>
    printings.map((printing, p) => ({
      id: `${key}::${printing}`,
      provider_card_id: key,
      name: "Primeape",
      set_name,
      card_number,
      printing,
      language: "English",
      game: "pokemon",
      pricing: {
        NM: {
          reference_cents: 1000 + s * 100 + p * 10,
          source_updated_at: fresh(),
        },
      },
    })),
  );
  await page.route("**/api/cards?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cards }),
    }),
  );
  // No readable text, then the customer types only the name: the same
  // evidence as a scan that reads the name but not the number.
  await fakeCamera(page, { lines: [] });
  await page.goto("/");
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText("Could not identify")).toBeVisible({
    timeout: 150_000,
  });
  await page.getByLabel("Card name").fill("Primeape");
  await page.getByRole("button", { name: "Search again" }).click();
  const panel = page.locator("#scanner-panel");
  await expect(panel.locator(".scanner-needs-number")).toBeVisible();
  await expect(panel.locator(".scanner-title")).toHaveText(
    "Several cards match the name. Which one is yours?",
  );
  // Tied candidates: nothing is highlighted as the likely card.
  await expect(panel.locator(".scan-candidate.is-primary")).toHaveCount(0);
  // Five distinct cards with both printings each; the sixth is counted.
  await expect(panel.locator(".scan-candidate")).toHaveCount(10);
  await expect(panel).toContainText("1 more match");
  // The correction form is open, ready for the printed number.
  const form = panel.locator("details.scanner-correct");
  await expect(form).toHaveAttribute("open", "");

  await form.locator('input[name="number"]').fill("43/64");
  await form.getByRole("button", { name: "Search again" }).click();
  // The number now decides: Jungle leads and is highlighted, others are flagged.
  const lead = panel.locator(".scan-candidate.is-primary");
  await expect(lead).toHaveCount(1);
  await expect(lead).toContainText("Jungle");
  await expect(panel.locator(".scanner-needs-number")).toHaveCount(0);
  await expect(
    panel.locator(".scan-candidate", { hasText: "Aquapolis" }).first(),
  ).toContainText("Read from your card: 43/64");

  // Confirm the Unlimited printing and price exactly that printing.
  await panel
    .locator(".scan-candidate", { hasText: "Unlimited" })
    .getByRole("button", { name: "Use this card" })
    .click();
  await page.getByRole("button", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  const unlimited = cards.find((card) => card.id === "jungle::Unlimited");
  const expected = Number(
    (BigInt(unlimited.pricing.NM.reference_cents) * 6000n + 5000n) / 10000n,
  );
  await expect(page.locator("#offer-value")).toHaveText(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(expected / 100),
  );
});
