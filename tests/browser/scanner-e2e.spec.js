import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

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
  // "Read by AI" renders as matching starts, before the catalog request is
  // routed, so wait for the search instead of reading it once.
  await expect.poll(() => searches).toContain("pokemon:199/165");
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
  // Both Jungle printings are highlighted: the number identifies the card,
  // not whether it is 1st Edition or Unlimited.
  const lead = panel.locator(".scan-candidate.is-primary");
  await expect(lead).toHaveCount(2);
  await expect(lead.nth(0)).toContainText("Jungle");
  await expect(lead.nth(1)).toContainText("Jungle");
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

test("One Piece printings sharing a number: none implied, value range shown, the chosen printing priced", async ({
  page,
}) => {
  // Real OP05-119 catalog identities (10 listings: standard, alternate art,
  // manga, SP, gold SP, reprint, promos). Prices are illustrative only, but
  // keep the real shape: the same printed name and number span ~1000x.
  const { groups } = JSON.parse(
    readFileSync(
      new URL("../fixtures/provider-variants.json", import.meta.url),
    ),
  );
  const group = groups.find(
    (g) => g.game === "one-piece-card-game" && g.number === "OP05-119",
  );
  const price = (name) => {
    if (name.includes("(Alternate Art) (Manga)")) return null; // unpriced
    if (name.includes("(SP) (Gold)")) return 1000000;
    if (/\((SP|Manga)\)/.test(name)) return 400000;
    if (name.includes("Alternate Art")) return 15000;
    return 1000;
  };
  const cards = group.entries.map((entry) => {
    const cents = price(entry.name);
    return {
      ...entry,
      pricing:
        cents === null
          ? {}
          : { NM: { reference_cents: cents, source_updated_at: fresh() } },
    };
  });
  await page.route("**/api/cards?**", (route) => {
    const game = new URL(route.request().url()).searchParams.get("game");
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cards: game === "one-piece-card-game" ? cards : [],
      }),
    });
  });
  await fakeCamera(page, { lines: [] });
  await page.goto("/");
  const scan = async () => {
    await page
      .getByRole("button", { name: /Scan a card|Scan next card/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Capture" }).click();
    await expect(page.getByText("Could not identify")).toBeVisible({
      timeout: 150_000,
    });
    await page.getByLabel("Card name").fill("Monkey.D.Luffy");
    await page.getByLabel("Card number").fill("OP05-119");
    await page.getByRole("button", { name: "Search again" }).click();
  };
  await scan();
  const panel = page.locator("#scanner-panel");
  const distinct = new Set(cards.map((c) => c.provider_card_id)).size;
  await expect(panel.locator(".scanner-title")).toHaveText(
    `${distinct} printings share this number. Which one is yours?`,
  );
  const warning = panel.locator(".scanner-printing-choice");
  await expect(warning).toContainText("$10.00 to $10,000.00");
  await expect(warning).toContainText("with no online price");
  // Every printing listed, none highlighted.
  await expect(panel.locator(".scan-candidate")).toHaveCount(cards.length);
  await expect(panel.locator(".scan-candidate.is-primary")).toHaveCount(0);

  // Picks the listing whose name is exactly `name` (names nest: "(Alternate
  // Art)" is a prefix of "(Alternate Art) (Manga)").
  const choose = (name, set) =>
    panel
      .locator(".scan-candidate")
      .filter({
        has: page.locator("strong", {
          hasText: new RegExp(`^${name.replace(/[.()]/g, "\\$&")}$`),
        }),
      })
      .filter({ hasText: set })
      .getByRole("button", { name: "Use this card" })
      .click();
  const offerFor = (cents) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number((BigInt(cents) * 6000n + 5000n) / 10000n) / 100);

  // The alternate art is priced as the alternate art.
  await choose(
    "Monkey.D.Luffy (119) (Alternate Art)",
    "Awakening of the New Era",
  );
  await page.getByRole("button", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#offer-value")).toHaveText(offerFor(15000));
  await expect(page.locator("#result-card-label")).toContainText(
    "Alternate Art",
  );

  // Correcting to the standard printing drops the alternate-art offer first.
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText("Could not identify")).toBeVisible({
    timeout: 150_000,
  });
  await page.getByLabel("Card name").fill("Monkey.D.Luffy");
  await page.getByLabel("Card number").fill("OP05-119");
  await page.getByRole("button", { name: "Search again" }).click();
  await choose("Monkey.D.Luffy (119)", "Awakening of the New Era");
  await expect(page.locator("#result-ready")).toBeHidden();
  await expect(page.locator("#add-to-list")).toBeHidden();
  await page.getByRole("button", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#offer-value")).toHaveText(offerFor(1000));

  // A printing with no price is never priced as another printing.
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText("Could not identify")).toBeVisible({
    timeout: 150_000,
  });
  await page.getByLabel("Card name").fill("Monkey.D.Luffy");
  await page.getByLabel("Card number").fill("OP05-119");
  await page.getByRole("button", { name: "Search again" }).click();
  await choose(
    "Monkey.D.Luffy (119) (Alternate Art) (Manga)",
    "Awakening of the New Era",
  );
  await expect(
    page.locator('.condition-option[data-code="NM"] .condition-note'),
  ).toHaveText("No online price");
  await page.getByRole("button", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#result-unavailable")).toBeVisible();
  await expect(page.locator("#result-ready")).toBeHidden();
});

test("One Piece layout, number unreadable: the type line and ability text are not searched as the name", async ({
  page,
}) => {
  // The reported failure: the affiliation printed under a One Piece name
  // ("… Pirates", "… Crew") was read and searched as the name, and the
  // provider's fuzzy matches (other crews, other sets) were offered.
  const zoro = (number, set_name, label, cents) => ({
    id: `zoro-${number}-${label}::normal`,
    provider_card_id: `zoro-${number}-${label}`,
    game: "one-piece-card-game",
    name: label ? `Roronoa Zoro (${label})` : "Roronoa Zoro",
    card_number: number,
    set_name,
    printing: "Normal",
    language: "English",
    pricing: { NM: { reference_cents: cents, source_updated_at: fresh() } },
  });
  const zoros = [
    zoro("OP01-001", "Romance Dawn", "", 300),
    zoro("OP01-001", "Romance Dawn", "Alternate Art", 4000),
    zoro("OP06-118", "Wings of the Captain", "", 2500),
    zoro("OP06-118", "Wings of the Captain", "Alternate Art", 30000),
  ];
  const decoy = {
    ...zoro("ST99-999", "Decoy Deck", "", 100),
    id: "decoy::normal",
    provider_card_id: "decoy",
    name: "Fake Straw Hat Crew",
  };
  const searches = [];
  await page.route("**/api/cards?**", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    searches.push(q);
    const cards = /crew|pirates/i.test(q)
      ? [decoy]
      : /zoro/i.test(q)
        ? zoros
        : zoros.filter((card) => card.card_number === q);
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cards }),
    });
  });
  await fakeCamera(page, {
    lines: [
      { text: "When Attacking", size: 30, x: 0.08, y: 0.55 },
      { text: "Roronoa Zoro", size: 40, x: 0.2, y: 0.86 },
      { text: "Straw Hat Crew", size: 26, x: 0.28, y: 0.93 },
    ],
  });
  await page.goto("/");
  await page.getByLabel("Game").selectOption("one-piece-card-game");
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Capture" }).click();
  const panel = page.locator("#scanner-panel");
  await expect(page.getByText("Needs confirmation")).toBeVisible({
    timeout: 150_000,
  });
  expect(searches.some((q) => /zoro/i.test(q))).toBe(true);
  expect(searches.filter((q) => /crew|attack/i.test(q))).toEqual([]);
  await expect(panel).not.toContainText("Fake Straw Hat Crew");
  // Same name, two sets, two arts each: no set or art is implied.
  await expect(panel.locator(".scanner-title")).toHaveText(
    "Several cards match the name. Which one is yours?",
  );
  await expect(panel.locator(".scan-candidate.is-primary")).toHaveCount(0);
  await expect(panel.locator(".scan-candidate")).toHaveCount(4);
  const form = panel.locator("details.scanner-correct");
  await expect(form).toHaveAttribute("open", "");

  // The customer types the printed number: both printings of that number are
  // offered, neither favoured, and the chosen alternate art is priced as such.
  await form.locator('input[name="number"]').fill("OP06-118");
  await form.getByRole("button", { name: "Search again" }).click();
  await expect(panel.locator(".scanner-title")).toHaveText(
    "2 printings share this number. Which one is yours?",
  );
  await expect(panel.locator(".scan-candidate.is-primary")).toHaveCount(0);
  await panel
    .locator(".scan-candidate", { hasText: "Roronoa Zoro (Alternate Art)" })
    .filter({ hasText: "Wings of the Captain" })
    .getByRole("button", { name: "Use this card" })
    .click();
  await page.getByRole("button", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: /Calculate estimated offer/ }).click();
  await expect(page.locator("#offer-value")).toHaveText("$180.00");
});

test("a number that belongs to a differently named card is questioned, not highlighted", async ({
  page,
}) => {
  const card = (id, name, card_number) => ({
    id: `${id}::normal`,
    provider_card_id: id,
    game: "one-piece-card-game",
    name,
    card_number,
    set_name: "Test Set",
    printing: "Normal",
    language: "English",
    pricing: { NM: { reference_cents: 500, source_updated_at: fresh() } },
  });
  await page.route("**/api/cards?**", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    const cards = /roronoa|zoro/i.test(q)
      ? [card("zoro", "Roronoa Zoro", "OP06-118")]
      : q === "OP05-110"
        ? [card("holly", "Holly", "OP05-110")]
        : [];
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cards }),
    });
  });
  // The same evidence as a scan that reads the name and misreads the number
  // as another real card's code, entered through the correction form (the
  // real-OCR cases are measured in tests/scanner-onepiece.test.js).
  await fakeCamera(page, { lines: [] });
  await page.goto("/");
  await page.getByLabel("Game").selectOption("one-piece-card-game");
  await page.getByRole("button", { name: /Scan a card/ }).click();
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText("Could not identify")).toBeVisible({
    timeout: 150_000,
  });
  await page.getByLabel("Card name").fill("Roronoa Zoro");
  await page.getByLabel("Card number").fill("OP05-110");
  await page.getByRole("button", { name: "Search again" }).click();
  const panel = page.locator("#scanner-panel");
  await expect(panel.locator(".scanner-title")).toHaveText(
    "The name and number we read point to different cards.",
  );
  await expect(panel.locator(".scan-candidate.is-primary")).toHaveCount(0);
  await expect(
    panel.locator(".scan-candidate", { hasText: "Holly" }),
  ).toContainText("Only the number matches");
  // The card the name fits is listed, its own number shown against the read.
  await expect(
    panel.locator(".scan-candidate", { hasText: "Roronoa Zoro" }),
  ).toContainText("Read from your card: OP05-110");
  await expect(panel.locator("details.scanner-correct")).toHaveAttribute(
    "open",
    "",
  );
});
