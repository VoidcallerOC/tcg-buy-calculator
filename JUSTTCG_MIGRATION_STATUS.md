# HARD HITTIN — JUSTTCG PROVIDER MIGRATION STATUS

## Current status

**YELLOW — SOFTWARE COMPLETE / PROVIDER ACTIVATION REQUIRED**

JustTCG is implemented as the intended production provider through the existing server-side provider architecture. The customer browser does not call JustTCG directly, and production does not silently fall back to TCGCSV or sample data.

## Verified provider terms

The official JustTCG commercial-use guidance and Terms checked on **2026-09-14** state that an active paid subscription permits end-user display, derived analytics, server-side caching, historical storage, and charging for an application. Attribution is appreciated but not required on paid tiers. Raw-data redistribution, bulk exports, API proxying, and pricing-API substitution are prohibited. The free tier is personal and non-commercial.

References:

- [JustTCG commercial-use guidelines](https://justtcg.com/docs/commercial-use)
- [JustTCG Terms of Service](https://justtcg.com/terms)
- [JustTCG API quickstart](https://justtcg.com/docs/quickstart)
- [JustTCG cards API](https://justtcg.com/docs/api/cards)

## Current authorization state

- Provider: **JustTCG**
- Credential: **CONFIGURED server-side in Supabase Edge Function Secrets**
- Commercial use: **UNCLEAR** until an active paid plan is configured and recorded
- Derived pricing: **UNCLEAR** until the paid-plan evidence is recorded
- Attribution: **UNCLEAR**
- Overall provider authorization: **PENDING**
- Production: **BLOCKED**

An API key alone is not treated as commercial authorization. The deployment must use a paid plan and must not expose the key to the browser. The current Edge Function secret confirms credential configuration only; it does not verify the subscription tier.

## Implemented

- Server-side `JUSTTCG_API_KEY` adapter.
- `x-api-key` authentication.
- `/games`, `/sets`, `/cards` pagination and batch lookup.
- Card, set, game, variant condition, price, source, and timestamp normalization.
- Non-negative numeric-price validation.
- Freshness metadata from JustTCG `lastUpdated` timestamps.
- JustTCG-only production provider selection with no TCGCSV fallback.
- Existing Hard Hittin condition-neutral policy preserved at 100% for all five conditions.
- Existing 60% buy-rate calculation preserved.
- Existing authenticated, transactional Supabase publication path preserved.

## Remaining activation requirements

1. Obtain an active paid JustTCG plan for the production application.
2. Store `JUSTTCG_API_KEY` as a server-side deployment secret.
3. Record the provider plan, terms URL, checked date, scope, restrictions, and evidence in the compliance record.
4. Run a controlled server-side sync preview for the intended games.
5. Validate identifiers, prices, timestamps, freshness, and catalog boundaries.
6. Publish transactionally and verify the customer end-to-end flow.

Until those steps pass, the system must remain **YELLOW / BLOCKED**.
