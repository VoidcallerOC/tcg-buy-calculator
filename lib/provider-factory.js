import { createJustTcgProvider } from "./justtcg-provider.js";

export function createProductionProvider({
  provider = "justtcg",
  ...options
} = {}) {
  if (provider !== "justtcg") {
    throw new Error(
      `Unsupported production provider: ${provider}. JustTCG is the only production provider.`,
    );
  }
  return createJustTcgProvider(options);
}
