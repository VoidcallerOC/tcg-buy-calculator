# Forge-CT TCG Buy Calculator

A reusable, white-label TCG buying calculator owned and maintained by Forge-CT. The first client configuration is Hard Hittin; future clients such as The Sunny should require configuration and pricing data, not a copied application.

## Run locally

Install dependencies with `npm install`. Run `npm test` for formatting and calculation tests. Serve the repository with `python3 -m http.server 4173` and open `http://localhost:4173/`. The browser regression suite can be run with `npm run test:browser` after installing the Playwright browser runtime.

The included pricing records are clearly marked development sample data. Replace them with an authorized maintained pricing dataset before launch. No TCGplayer API, scraper, or fake live pricing integration is included.

## Project structure

- `index.html`, `app.js`, and `styles.css`: mobile-first customer calculator.
- `data/config.json`: white-label client configuration; Hard Hittin is configured at 60%.
- `data/sample-pricing.json`: development-only sample cards and pricing.
- `lib/money.js`: integer-cent calculation engine.
- `lib/lookup.js`: card and pricing lookup layer.
- `lib/csv-import.js`: safe CSV validation and import preview parser.
- `admin/`: preview-only admin import workflow.
- `docs/TCG_BUY_CALCULATOR.md`: architecture, operations, security, and provider guidance.
- `docs/CLIENT_SETUP.md`: instructions for configuring a new shop without copying the codebase.

## Production boundary

This repository is a static application and does not currently include a database or authentication server. The admin page therefore validates and previews CSV files only; it never persists or publishes an upload. Production must connect the parser to an authenticated server-side database adapter with transactional upserts, pricing history, admin authorization, and server-side validation before live imports are enabled.
