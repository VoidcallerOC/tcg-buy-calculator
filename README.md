# Forge-CT TCG Buy Calculator

A small, white-label TCG buying calculator for Forge-CT clients. Hard Hittin is the first client; The Thousand Sunny can use the same application through client configuration and a separate pricing dataset.

## Current status

The repository has a working customer calculator, integer-cent offer engine, deterministic card lookup, explicit condition handling, safe CSV validation, authenticated admin sign-in/publishing UI, and a real Supabase/Postgres production schema with transactional pricing import RPC. The checked-in browser configuration remains in **development sample mode** until an authorized pricing dataset is imported and the client is switched to production mode.

Sample prices are never presented as live prices.

## Local development

```bash
npm install
npm test
npm run test:browser
python3 -m http.server 4173
```

Open `http://localhost:4173/`. The browser suite uses the sample dataset and does not require Supabase authentication.

## Production architecture

The frontend is a static Vercel-compatible site. Supabase provides Postgres, row-level security, authentication, and the server-side transactional publish function. The browser uses only the Supabase project URL and publishable key; no service-role key or database credential is shipped to the client.

The production schema is in [`supabase/migrations/20260914210000_tcg_calculator.sql`](supabase/migrations/20260914210000_tcg_calculator.sql) and has been applied to the configured ForgeCT Supabase project. It creates clients, conditions, cards, pricing, pricing history, client-admin assignments, and import records. A partial unique index prevents more than one active price per client/card/condition. The `tcg_publish_pricing_import` function validates authorization and data, deactivates prior active prices, records history, and publishes the complete import in one transaction.

## Production setup

1. Create an administrator in the ForgeCT Supabase Auth project.
2. Insert that user’s UUID into `public.tcg_client_admins` for `client_id = 'hard-hittin'` using a protected database/admin workflow. Never expose a service-role key in the browser.
3. Obtain an authorized maintained pricing dataset. Do not scrape or proxy an unauthorized provider.
4. Sign in at `/admin/`, upload the eight-column CSV, review validation counts, and publish it. The browser preview cannot publish without an authenticated Supabase session and server-side RPC authorization.
5. Change `data/config.json` from `pricing_mode: "sample"` to `pricing_mode: "production"` only after the production dataset exists. Keep the Supabase project URL and publishable key; these are public client settings, not secrets.
6. Deploy the repository through the linked Vercel Git project. The static frontend reads production cards and pricing through RLS-protected public read policies.

## CSV format

Required headers are:

`card_name`, `set_name`, `set_code`, `card_number`, `condition`, `reference_market_low`, `source_name`, `source_updated_at`

Prices are parsed into integer cents. Rows must contain required values, supported conditions, valid non-negative prices, and ISO dates. Duplicate rows are rejected. Imported values are displayed as text, not HTML. The production RPC validates again and never deletes records merely because they are absent from a partial upload.

## Freshness and errors

Production pricing carries source and update dates. `stale_threshold_days` is configurable in the client configuration; the current documented default is 7 days. When the production dataset is stale and `allow_stale_pricing` is false, the customer sees an unavailable state requiring in-store verification rather than a silently current-looking estimate. Network, missing-client, missing-price, duplicate-price, and stale-price states are explicit.

## Security model

Customers can read active clients, cards, conditions, and active pricing through RLS policies. Administrators must authenticate with Supabase Auth and be assigned to the client. Import publication is server-side through a `security definer` function that checks `auth.uid()`, validates all rows again, performs transactional writes, and records history. No credentials, API keys, or service-role secrets are committed.

## Remaining launch dependency

The code and database boundary are functional. Hard Hittin’s approved condition-neutral online policy and 60% buy rate are configured. The repository cannot honestly be called green until TCGCSV commercial-use, derived-pricing redistribution, and attribution authorization are documented, a real admin account is assigned, and authorized production pricing is published. Those are operational and external inputs, not fabricated defaults.

## Pricing providers

JustTCG is the intended production provider. Its API adapter is server-side only, uses the `JUSTTCG_API_KEY` secret, normalizes card variants into the existing pricing model, retains source and fetch timestamps, and never exposes provider credentials to the customer browser. JustTCG production use remains blocked until an active paid plan and provider compliance evidence are recorded. See [`docs/JUSTTCG_SOURCE_NOTES.md`](docs/JUSTTCG_SOURCE_NOTES.md).

TCGCSV remains available only as a legacy/reference implementation while its external authorization is unresolved. It is not a production fallback for JustTCG.

### Legacy TCGCSV provider

The repository now includes a server-side `TCGCSVProvider`, normalization layer, weekly sync engine, deterministic fixtures, and a JWT-protected Supabase Edge Function status boundary. It uses the documented TCGCSV JSON endpoints for categories, groups, products, and group prices; checks `last-updated.txt`; sends a descriptive User-Agent; paces requests; and respects the documented daily-sync and request-volume guidance. Categories are discovered dynamically, pricing is batched by product group, missing market prices are rejected, and category-level failures do not delete last-known-good pricing.

TCGCSV’s documented `marketPrice` is a product/variation market value and does not guarantee a condition. The adapter therefore requires an explicit variation-to-condition mapping. Unknown variations such as `Normal`, `Holofoil`, or `Reverse Holofoil` are not silently labeled Near Mint or Lightly Played. If no valid reference price or safe condition mapping exists, pricing is unavailable. The source timestamp, provider product ID, variation, fetched timestamp, and freshness status are retained.

TCGCSV credentials are not required by the documented public endpoints, but all ingestion remains server-side. The customer browser never fetches TCGCSV directly. The deployed `tcgcsv-sync` function reports source availability and the latest source timestamp; a sync must still be previewed and transactionally published before production mode is enabled.

Before commercial production use, obtain written confirmation that the intended TCGCSV-derived pricing use is permitted, including derived-price redistribution and attribution. The reviewed TCGCSV documentation provides endpoint and processing guidance but does not state a clear commercial redistribution or embedding license. Hard Hittin’s approved condition-neutral online policy uses the same market reference for NM, LP, MP, HP, and DMG; it is a shop policy and must not be described as TCGCSV condition-specific pricing.

The manual authorization request, official contact channels, evidence requirements, and later activation workflow are documented in [`docs/TCGCSV_AUTHORIZATION_REQUEST.md`](docs/TCGCSV_AUTHORIZATION_REQUEST.md). The connected GitHub integration cannot create issues in the external TCGCSV repository; that limitation does not change the calculator’s authorization status.
