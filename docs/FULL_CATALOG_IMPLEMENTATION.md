# Full Catalog Implementation

The calculator now separates **provider ingestion**, **server-side catalog storage**, **indexed search**, and **offer calculation**. `lib/justtcg-provider.js` discovers games from `GET /games`, discovers every set from `GET /sets?game=...`, and iterates every card page from `GET /cards` using offset pagination until `meta.hasMore` is false. A repeated offset or empty page terminates safely. Provider UUIDs and payloads are retained.

`lib/catalog-sync.js` normalizes game-aware card identities as `provider_game_id + provider_card_id`, preserves sets and variants/printings, records progress, and supports repeatable upserts. `scripts/sync-catalog.mjs` runs the import server-side with a service-role Supabase repository; the browser never downloads the catalog or owns provider credentials. Pricing rows are stored independently from card metadata.

The Supabase migration `20260916140000_full_tcg_catalog.sql` creates `tcg_games`, `tcg_sets`, `tcg_catalog_cards`, `tcg_card_variants`, `tcg_catalog_prices`, and `tcg_sync_runs`, with indexes and the `tcg_catalog_search` RPC. `/api/cards?game=<provider-game-id>&q=<query>` searches this index and returns a small relevant result set. `/api/games` enumerates currently indexed games. `/api/catalog-status` is an administrator-token-protected health endpoint.

## Provider facts verified 2026-09-16

JustTCG documents **20 games** and approximately **279,000 cards**. Exact provider IDs are returned dynamically by `/games`, rather than guessed or hardcoded. The documented catalog includes YuGiOh (`yugioh`), UniVersus (`universus`), Union Arena (`union-arena`), Star Wars: Unlimited (`star-wars-unlimited`), Sorcery: Contested Realm (`sorcery-contested-realm`), Riftbound, Pokemon Japan (`pokemon-japan`), Pokemon (`pokemon`), Palworld (`palworld-official-card-game`), One Piece (`one-piece-card-game`), Magic: The Gathering (`magic-the-gathering`), hololive, Gundam, Grand Archive, Flesh and Blood, Dragon Ball Super: Masters, Dragon Ball Super: Fusion World, Disney Lorcana, Digimon, and Cyberpunk TCG (`cyberpunk-tcg`). The application uses the live `/games` response as the source of truth.

The stable v1 API requires `x-api-key`. Documented GET page limits are plan-dependent: Free 20, Starter/Professional 100, Enterprise 200. The implementation defaults to 100 and can be configured lower for the account plan. The documented rate limits are Free 100 requests/day, Starter 1,000/day, Professional 5,000/day, and Enterprise 50,000/day. A complete initial import therefore requires an appropriately sized paid plan and must be run as a server-side job; no completeness claim is made until the health endpoint reports a completed run.

## Launch checklist

Set `JUSTTCG_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and `CATALOG_ADMIN_TOKEN` in the server environment. Apply the migration, run `node scripts/sync-catalog.mjs`, inspect `/api/catalog-status` with `Authorization: Bearer <CATALOG_ADMIN_TOKEN>`, and schedule catalog/pricing refreshes according to the provider plan and commercial-use terms. The 60% offer calculation remains unchanged.
