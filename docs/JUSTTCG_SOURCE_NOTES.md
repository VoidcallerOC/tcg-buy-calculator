# JustTCG Provider Research

Checked 2026-09-14 against the official JustTCG documentation.

## API

- Quickstart: https://justtcg.com/docs/quickstart
- Cards API: https://justtcg.com/docs/api/cards
- Variant schema: https://justtcg.com/docs/schema/variant
- Commercial-use guidelines: https://justtcg.com/docs/commercial-use
- Binding Terms of Service: https://justtcg.com/terms
- Pricing: https://justtcg.com/pricing

The API base URL is `https://api.justtcg.com/v1`. Requests use the server-side `x-api-key` header. The stable `/cards` endpoint supports GET lookup and POST batch lookup. Card responses include identifiers, game, set, TCGplayer ID, variants, condition, printing, USD price, and Unix `lastUpdated` timestamps. POST batch size depends on plan; the documented limits are 20 for Free, 100 for Starter/Pro, and 200 for Enterprise.

## Commercial and licensing status

The official commercial-use guidance and Terms permit end-user display, derived analytics, server-side caching, historical storage, and charging for a product on an active paid subscription. Attribution is appreciated but not required on paid tiers. Raw-data feeds, bulk exports, API proxying, and pricing-API substitution are prohibited. The free tier is personal and non-commercial.

Accordingly, the provider adapter is implemented, but production authorization remains **UNCLEAR** until Hard Hittin has an active paid JustTCG plan and the deployment records the applicable subscription/compliance evidence. An API key alone does not establish commercial authorization.

## Data interpretation

JustTCG describes prices as volume-weighted averages of observed market activity. The calculator therefore labels the value as a market reference. JustTCG condition-specific variants are not substituted into Hard Hittin’s approved policy; all five shop conditions remain at 100% of the provider market reference, then the 60% buy rate is applied.
