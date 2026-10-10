import { defineConfig, devices } from "@playwright/test";

// Read-only smoke test of a deployed site, using live pricing and the real
// OCR engine. Usage: SMOKE_BASE_URL=https://… npm run test:smoke
export default defineConfig({
  testDir: "./tests/smoke",
  reporter: "line",
  timeout: 180_000,
  use: {
    baseURL:
      process.env.SMOKE_BASE_URL ?? "https://tcg-buy-calculator.vercel.app",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Pixel 7"],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
});
