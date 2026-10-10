import { test, expect } from "@playwright/test";

// Supabase is mocked at the network layer. Requests still pass through the
// browser's Content-Security-Policy first, so these tests also prove the
// admin page may reach the configured Supabase project.
const SUPABASE = "https://agscctnjusfqcpisirsq.supabase.co";
const HEADER =
  "card_name,set_name,set_code,card_number,condition,reference_market_low,source_name,source_updated_at";

async function mockSupabase(page, { signIn = true, publish } = {}) {
  const calls = [];
  await page.route(`${SUPABASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push(`${request.method()} ${url.pathname}`);
    const json = (status, body) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/auth/v1/token")
      return signIn
        ? json(200, { access_token: "user-jwt", token_type: "bearer" })
        : json(400, { error_description: "Invalid login credentials" });
    if (url.pathname === "/rest/v1/tcg_clients")
      return json(200, [
        {
          id: "default",
          business_name: "TCG Buy Calculator",
          buy_rate_basis_points: 6000,
        },
      ]);
    if (url.pathname === "/rest/v1/tcg_conditions")
      return json(200, [
        { code: "NM", name: "Near Mint" },
        { code: "LP", name: "Lightly Played" },
        { code: "MP", name: "Moderately Played" },
        { code: "HP", name: "Heavily Played" },
        { code: "DMG", name: "Damaged" },
      ]);
    if (url.pathname === "/rest/v1/tcg_condition_policies")
      return json(200, []);
    if (url.pathname === "/rest/v1/tcg_source_compliance")
      return json(200, [
        { provider: "JustTCG", commercial_use_status: "UNCLEAR" },
      ]);
    if (url.pathname === "/functions/v1/justtcg-sync") return json(404, {});
    if (url.pathname === "/rest/v1/rpc/tcg_publish_pricing_import")
      return publish(json, request);
    return json(404, {});
  });
  return calls;
}

async function signIn(page) {
  await page.goto("/admin/");
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("correct horse");
  await page.getByRole("button", { name: /Sign in/ }).click();
}
const upload = (page, text) =>
  page.locator("#csv-file").setInputFiles({
    name: "pricing.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(text),
  });

test("rejected credentials keep the import panel locked", async ({ page }) => {
  await mockSupabase(page, { signIn: false });
  await signIn(page);
  await expect(page.locator("#login-message")).toHaveText(
    "Invalid login credentials",
  );
  await expect(page.locator("#import-panel")).toBeHidden();
});

test("CSV preview catches malformed, duplicate, unsupported, and invalid rows without publishing", async ({
  page,
}) => {
  const cspErrors = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text()))
      cspErrors.push(message.text());
  });
  const calls = await mockSupabase(page, {
    publish: () => {
      throw new Error("preview must not publish");
    },
  });
  await signIn(page);
  await expect(page.locator("#import-panel")).toBeVisible();
  await expect(page.locator("#provider-status")).toContainText(
    "status is unavailable",
  );

  await upload(page, "card_name,set_name\nLuffy,OP05\n");
  await expect(page.locator("#import-errors")).toContainText(
    "Missing required columns",
  );
  await expect(page.getByRole("button", { name: /Publish/ })).toBeDisabled();

  await upload(
    page,
    [
      HEADER,
      "Luffy,Awakening,OP05,OP05-119,Near Mint,10.00,JustTCG,2026-10-09",
      "Luffy,Awakening,OP05,OP05-119,Near Mint,11.00,JustTCG,2026-10-09",
      "Zoro,Awakening,OP05,OP05-001,Mint-ish,5.00,JustTCG,2026-10-09",
      "Nami,Awakening,OP05,OP05-002,Near Mint,-4,JustTCG,2026-10-09",
      "Sanji,Awakening,OP05,OP05-003,Near Mint,abc,JustTCG,2026-10-09",
      "Usopp,Awakening,OP05,OP05-004,Near Mint,1.00,JustTCG,10/09/2026",
    ].join("\n"),
  );
  const errors = page.locator("#import-errors");
  await expect(errors).toContainText("Row 3: Duplicate row in upload.");
  await expect(errors).toContainText("Row 4: Invalid condition: Mint-ish");
  await expect(errors).toContainText("Row 5: Price must be");
  await expect(errors).toContainText("Row 6: Price must be");
  await expect(errors).toContainText("Row 7: Invalid source date");
  await expect(page.locator("#import-summary")).toContainText("Errors 5");
  await expect(page.getByRole("button", { name: /Publish/ })).toBeDisabled();
  expect(
    calls.some((call) => call.includes("tcg_publish_pricing_import")),
  ).toBe(false);
  expect(cspErrors).toEqual([]);
});

test("publish is a separate explicit step and a server rejection changes nothing", async ({
  page,
}) => {
  let published = 0;
  await mockSupabase(page, {
    publish: (json, request) => {
      published += 1;
      expect(request.headers().authorization).toBe("Bearer user-jwt");
      return json(403, {
        code: "42501",
        message: "Unauthorized pricing import.",
      });
    },
  });
  await signIn(page);
  // Conditions load during sign-in; uploading earlier validates against none.
  await expect(page.locator("#import-panel")).toBeVisible();
  await upload(
    page,
    `${HEADER}\nLuffy,Awakening,OP05,OP05-119,Near Mint,10.00,JustTCG,2026-10-09\n`,
  );
  const publish = page.getByRole("button", { name: /Publish/ });
  await expect(publish).toBeEnabled();
  expect(published).toBe(0);
  await publish.click();
  await expect(page.locator("#import-message")).toContainText(
    "Publish failed; the transaction was rolled back.",
  );
  await expect(page.locator("#import-message")).toContainText(
    "Unauthorized pricing import.",
  );
  expect(published).toBe(1);
});
