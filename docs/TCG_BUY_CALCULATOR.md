# Forge-CT TCG Buy Calculator

The TCG Buy Calculator is a reusable white-label product owned and maintained by Forge-CT. Hard Hittin is the first client configuration; The Thousand Sunny can become another client through data and configuration rather than a copied application.

## Architecture

The customer page remains a lightweight static application. In development/sample mode it reads `data/config.json` and `data/sample-pricing.json`. In production mode it reads active client, card, condition, and pricing records from the configured Supabase PostgREST API using only a publishable browser key. The production database and transactional import function are defined in `supabase/migrations/20260914210000_tcg_calculator.sql`.

The frontend retains the integer-cent and basis-point calculation engine. Supabase provides authentication, Postgres persistence, row-level security, pricing history, client-admin assignments, and the server-side publish function. No service-role credential is present in frontend code.

## Production data model

`tcg_clients` stores client branding, currency, buy-rate basis points, disclaimer, stale threshold, and stale-use policy. `tcg_conditions`, `tcg_cards`, and `tcg_pricing` store normalized lookup and price records. `tcg_pricing` includes source attribution, source update date, import time, active state, client identifier, and historical-effective fields. A partial unique index enforces one active price per client/card/condition. `tcg_pricing_history` preserves previous and new prices with actor and source metadata. `tcg_client_admins` assigns Supabase Auth users to clients, and `tcg_imports` records import outcomes.

## Import workflow

The admin page requires Supabase email/password authentication. A CSV is parsed and previewed in the browser, then the administrator explicitly publishes it. Publication calls the `tcg_publish_pricing_import` database function with the validated rows. The function checks the authenticated user’s client assignment, validates identifiers, conditions, prices, dates, and row limits again, updates cards, deactivates prior active prices, inserts new prices, records history, and returns a summary in one transaction. A failure rolls back pricing changes. Absent records are not deleted.

The current CSV contract requires `card_name`, `set_name`, `set_code`, `card_number`, `condition`, `reference_market_low`, `source_name`, and `source_updated_at`. The parser derives a deterministic card identity from `set_code` plus `card_number`; a future provider with a canonical external card ID can add that identifier without changing the pricing rules.

## Freshness and pricing honesty

The production client configuration contains `stale_threshold_days` and `allow_stale_pricing`. The customer calculates only when pricing is current or when the shop explicitly permits stale pricing. Otherwise it displays a stale/unavailable message requiring in-store verification. Sample mode clearly displays `DEVELOPMENT SAMPLE DATA — NOT LIVE PRICING`. No provider is invented or scraped. Before launch, the shop must supply an authorized maintained dataset with source, update cadence, timestamp, and failure policy.

## Authentication and authorization

Customer read access is protected by RLS policies that expose only active public records. Admin history and import records require client-admin membership. Publication is not protected by a hidden URL; it requires a valid Supabase Auth JWT and server-side membership verification. The remaining operational setup is to create the real admin account and assign its Auth UUID to `tcg_client_admins` through a protected workflow.

## Client configuration

The checked-in `data/config.json` retains Hard Hittin, 60%, USD, branding, disclaimer, and the Supabase project’s public URL/key. It is intentionally set to `pricing_mode: "sample"` until production pricing is imported. To launch a client, create its database client record, assign administrators, import an authorized dataset, configure the client identifier, and switch the deployment to production mode. No client-specific calculator source file is needed.

## Deployment

The repository is Vercel-compatible and contains no build step beyond serving static assets. Link the GitHub repository to a Vercel project and deploy the production branch after the operational setup is complete. Supabase schema application is already complete for the configured ForgeCT project. Vercel environment variables are not needed for the public read path because the URL and publishable key are public configuration; service-role keys must remain in protected server/database tooling and must never be committed.

## Troubleshooting and rollback

If production pricing is unavailable, the customer shows an explicit unavailable state rather than falling back to sample data. If an import fails, the database transaction rolls back and the prior active pricing remains. If a later price must be rolled back, deactivate the current price and publish the intended historical record through an authenticated administrative workflow; the history table retains the prior values and actor metadata.

## Development versus production

Development is the default checked-in mode and uses sample JSON for repeatable local and browser tests. Production mode reads Supabase records and requires a real authenticated administrator plus an authorized maintained pricing dataset. The system is functionally wired for production, but those external operational inputs must exist before the calculator can honestly be marked green.

## Official TCGplayer synchronization

`lib/tcgplayer-provider.js` is the provider boundary. It implements the documented OAuth client-credentials flow against `api.tcgplayer.com`, dynamic category/group/product discovery, pagination, bounded pricing batches, retry handling for rate limits and server errors, and credential-gated configuration. `lib/tcgplayer-normalizer.js` converts provider records into internal products and pricing records. `lib/tcgplayer-sync.js` runs a weekly sync model with category-level status, checkpoint callbacks, condition mapping, market-price selection, freshness classification, and failure isolation. Raw provider responses do not enter the customer UI.

The provider uses only official TCGplayer API access. There is no webpage scraping, unofficial endpoint, reverse-engineered API, browser automation, or third-party dataset. The current environment has no `TCGPLAYER_PUBLIC_KEY` or `TCGPLAYER_PRIVATE_KEY`, so the deployed `tcgplayer-sync` Edge Function reports `TCGplayer provider not configured`. Live synchronization cannot be enabled until authorized TCGplayer API access is supplied. The exact secrets belong only in the server-side Edge Function configuration.

The reference price rule is explicit: use the official API `marketPrice` returned for the matching product/condition subtype. Missing market price is unavailable; the adapter never silently substitutes low, mid, high, direct-low, or another condition. Provider conditions are mapped through an explicit table and unknown labels are rejected. Every normalized row carries provider/version, source product ID, fetched/effective timestamps, source update timestamp when supplied, and freshness status.

The applied sync metadata migration adds `tcg_sync_runs`, `tcg_sync_categories`, provider provenance, freshness, fetched/effective timestamps, and sync IDs to pricing history. Failed or partial categories are recorded; previously valid active pricing is not deleted because a provider request failed.
