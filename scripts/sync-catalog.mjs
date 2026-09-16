import { createJustTcgProvider } from "../lib/justtcg-provider.js";
import { syncCatalog } from "../lib/catalog-sync.js";
import { createSupabaseCatalogRepository } from "../lib/supabase-catalog-repository.js";

const result = await syncCatalog({
  provider: createJustTcgProvider({ pageSize: Number(process.env.JUSTTCG_PAGE_SIZE ?? 100) }),
  repository: createSupabaseCatalogRepository(),
  logger: ({ game, pages, sets, cards }) => console.log(JSON.stringify({ game, pages, sets, cards })),
});
console.log(JSON.stringify(result));
