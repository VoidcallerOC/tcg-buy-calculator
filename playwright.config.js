import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  reporter: "line",
  use: { baseURL: "http://127.0.0.1:4173" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional: point at a preinstalled Chromium when the bundled build is absent.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
  webServer: {
    // Serves vercel.json headers (CSP) and the /api functions; API calls
    // to the provider are mocked per test, and no provider key is passed.
    command: "node scripts/dev-server.mjs 4173",
    env: { JUSTTCG_API_KEY: "", SUPABASE_URL: "", SUPABASE_ANON_KEY: "" },
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
