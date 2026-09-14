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

## TCGCSV synchronization

`lib/tcgcsv-provider.js` is the first implementation of the shared provider boundary. It uses the documented server-side paths for categories, groups, products, and group prices, checks `last-updated.txt`, applies a descriptive User-Agent, paces requests, and caches group prices while joining them back to stable product IDs. `lib/tcgplayer-normalizer.js` converts provider records into internal products and pricing records. `lib/tcgplayer-sync.js` runs the weekly sync model with category-level status, checkpoint callbacks, condition mapping, market-price selection, freshness classification, and failure isolation. Raw provider responses do not enter the customer UI.

TCGCSV is not fetched by browser code and no TCGplayer web pages are scraped. The source documentation describes `marketPrice` as a product/variation value and explicitly warns that it is not a guaranteed condition. Therefore the reference price rule is: use TCGCSV `marketPrice` only when non-null and use a configured explicit variation-to-condition map; reject missing prices and unmapped variations rather than substituting low, mid, high, direct-low, or an assumed condition. Every normalized row carries provider/version, stable source product ID, variation, fetched/effective timestamps, source update timestamp, and freshness status.

The deployed JWT-protected `tcgcsv-sync` Edge Function checks source availability and reports the latest source timestamp. It does not imply that pricing is live: a sync must complete preview, validation, and transactional publishing before production mode is enabled.

The applied sync metadata migration adds `tcg_sync_runs`, `tcg_sync_categories`, provider provenance, freshness, fetched/effective timestamps, and sync IDs to pricing history. Failed or partial categories are recorded; previously valid active pricing is not deleted because a provider request failed.
