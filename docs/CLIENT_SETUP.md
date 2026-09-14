# Client setup: a new Forge-CT calculator deployment

Forge-CT operates one calculator application and configures each shop through data. A new client must not receive a source-code fork.

## Setup sequence

1. Create a row in `public.tcg_clients` with a stable identifier, business name, logo text, colors, currency, validated buy-rate basis points, disclaimer, contact details, stale threshold, and stale-use policy.
2. Create the shop administrator in Supabase Auth and add the user UUID to `public.tcg_client_admins` for the client. This is a protected operation; never put a service-role key in browser code.
3. Prepare an authorized pricing CSV with the required eight-column format.
4. Sign in at `/admin/`, upload the CSV, resolve validation errors and duplicate conflicts, and review the preview counts.
5. Explicitly publish the preview. The server-side transactional function revalidates rows, upserts cards, deactivates prior active prices, inserts the new active prices, records pricing history, and returns a summary. A failure leaves the previous dataset unchanged.
6. Configure `data/config.json` for the client identifier and production pricing mode, then deploy the same repository through Vercel.
7. Verify customer search, every supported condition, unavailable pricing, stale behavior, disclaimer text, and mobile layout.

## Pricing controls

Use an authorized provider or a maintained internal dataset. Include source name and ISO `source_updated_at` values. Do not scrape unauthorized sites, fabricate live prices, or describe sample data as current. The stale threshold is configurable per client; the customer must see a stale warning or unavailable state when the configured policy disallows stale estimates.

## Example clients

Hard Hittin uses a 60% buy rate and remains the reference client. The Thousand Sunny would use a different client row, branding, administrator assignment, and maintained pricing dataset. No `TheSunnyCalculator` or `HardHittinCalculator` component is needed.

## Launch checklist

- [ ] Authorized pricing source and update cadence documented
- [ ] Supabase client row created
- [ ] Real admin Auth account created
- [ ] Admin UUID assigned to `tcg_client_admins`
- [ ] Controlled CSV preview passes
- [ ] Controlled CSV publish succeeds
- [ ] Pricing history contains the import
- [ ] Production mode enabled only after pricing exists
- [ ] Vercel deployment verified
- [ ] Stale, unavailable, invalid CSV, and unauthorized states tested

## Official TCGplayer access

Live TCGplayer synchronization is credential-gated and uses only the documented official API. Supply authorized developer access, configure `TCGPLAYER_PUBLIC_KEY` and `TCGPLAYER_PRIVATE_KEY` as Supabase Edge Function secrets, verify the provider status changes from `NOT_CONFIGURED` to ready, and run the sync preview. Do not place either secret in this repository, Vercel public configuration, or browser code. If access is unavailable, the correct status is `TCGplayer provider not configured`; do not substitute scraping or third-party datasets.
