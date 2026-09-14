# Forge-CT TCG Buy Calculator

The TCG Buy Calculator is a reusable, white-label product owned and maintained by Forge-CT. Hard Hittin is the first client configuration; a future client such as The Sunny should require configuration and pricing data, not a copied codebase.

## Architecture

The customer page is a static, mobile-first interface under [`calculator/`](../calculator/). Configuration is loaded from `data/config.json`, pricing data is loaded from the maintained dataset, and the frontend delegates all matching and offer math to reusable modules in `lib/`. The calculation engine uses integer cents and basis points, so JavaScript floating-point artifacts cannot leak into displayed monetary values.

The current repository is a static Vercel site with no database or authentication layer. Therefore the included admin page is intentionally a **validation and preview surface only**. It never persists or publishes an upload. Production deployments should connect the parser to an authenticated server-side import endpoint and database adapter before enabling writes.

The intended provider boundary is `PricingProvider → InternalDatabaseProvider`, with a future `AuthorizedExternalProvider` implementing the same contract. No TCGplayer API, scraper, or fake live pricing is included.

## Local development

Run `npm install`, then `npm run test:calculator` for the pure module tests. Run `python3 -m http.server 4173` from the repository root and visit `/calculator/` to use the sample configuration. The sample data is clearly labeled and must be replaced before a client launch.

## Data model

A production database should normalize `clients`, `sets`, `cards`, `conditions`, `pricing`, and `pricing_history`. Pricing rows should be unique by card, condition, and active source. Store `reference_market_low` as integer cents, together with currency, source name, source update time, active state, and timestamps. A history row stores card, set, condition, previous price, new price, source, changed time, and authenticated actor.

## Pricing format and import process

The import format is CSV with these required headers: `card_name`, `set_name`, `set_code`, `card_number`, `condition`, `reference_market_low`, `source_name`, and `source_updated_at`. The parser validates headers, required values, supported conditions, monetary syntax, and duplicate rows. An import must preview create/update/skip/error counts and require explicit authenticated confirmation. It must use upserts for matching cards and pricing records and must never delete records merely because they are absent from an upload. A malformed upload must leave the existing dataset unchanged.

The included `/calculator/admin/` page demonstrates validation and preview only. Do not treat it as an admin authorization system. The production endpoint must enforce the repository’s chosen authentication and authorization mechanism server-side, validate every field again, record the actor in pricing history, and apply the update transactionally.

## Client configuration

Each client is a data record or deployment environment, not a source-code fork. Configure business name, logo, colors, currency, buy rate, disclaimer, contact information, and active state. The calculation remains `reference market low × configured client buy rate`. Hard Hittin is configured at 60%; the calculation engine contains no Hard Hittin-specific logic.

To deploy The Sunny, create a client configuration, import its authorized pricing dataset, select the deployment’s client identifier, and reuse the same application. Do not create `HardHittinCalculator.tsx` or another client-specific component.

## Buy-rate rules

Buy rates are validated server-side as percentages from 0% through 100%, stored as a configuration value, and converted to basis points for calculation. The frontend may display the configured rate, but customers cannot change it. The default disclaimer is: “This is an estimated buy offer based on maintained reference pricing data. Final offers are subject to in-person inspection, authenticity verification, and final condition assessment.”

## Weekly pricing maintenance

Forge-CT should obtain pricing through an authorized and legitimate source, stage the CSV, inspect validation and change counts, review outliers, confirm the import as an authenticated administrator, and retain the history log. Never scrape TCGplayer or expose a claim of live pricing when the dataset is maintained periodically.

## Security considerations

Customer routes should only expose read-only lookup and calculation results. All authoritative configuration, pricing, and percentage values must be loaded or calculated server-side in a production deployment. Admin import and configuration routes must require authenticated admin authorization, reject malformed input, use transactional upserts, apply rate limits, and avoid logging secrets. Never commit API keys, database credentials, or an admin token. The static preview included here does not provide production persistence or access control; that boundary is deliberate because this repository does not currently contain a server/database/auth stack.

## Final architecture review

Forge-CT can deploy the same calculator for The Sunny without copying the repository or rewriting the application: the UI, lookup, calculation, import validation, and future provider boundary are reusable, while client branding, buy rate, currency, disclaimer, and pricing records are configuration/data.
