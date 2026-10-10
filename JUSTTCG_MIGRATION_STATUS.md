# JUSTTCG PROVIDER MIGRATION STATUS

## Current status

**LIVE PRICING AUTHORIZED (paid Starter plan) — see open items below**

JustTCG is implemented as the intended production provider through the existing server-side provider architecture. The customer browser does not call JustTCG directly, and production does not silently fall back to TCGCSV or sample data.

## Verified provider terms

The official JustTCG commercial-use guidance and Terms checked on **2026-09-14** state that an active paid subscription permits end-user display, derived analytics, server-side caching, historical storage, and charging for an application. Attribution is appreciated but not required on paid tiers. Raw-data redistribution, bulk exports, API proxying, and pricing-API substitution are prohibited. The free tier is personal and non-commercial.

References:

- [JustTCG commercial-use guidelines](https://justtcg.com/docs/commercial-use)
- [JustTCG Terms of Service](https://justtcg.com/terms)
- [JustTCG API quickstart](https://justtcg.com/docs/quickstart)
- [JustTCG cards API](https://justtcg.com/docs/api/cards)

## Current authorization state (checked 2026-10-10)

- Provider: **JustTCG**
- Plan: **Starter Plan** (paid, $19/mo). Verified from the production key's own API response (`_metadata.apiPlan = "Starter Plan"`), not from the key's existence.
- Published terms checked 2026-10-10 ([pricing](https://justtcg.com/pricing), [commercial use](https://justtcg.com/docs/commercial-use)): paid tiers carry a commercial license; end-user display and derived calculations are permitted; attribution is not required on paid tiers.
- Commercial use: **AUTHORIZED** (paid plan per published terms)
- Derived pricing: **AUTHORIZED** (derived metrics permitted)
- Attribution: **NOT_REQUIRED**
- Credential: `JUSTTCG_API_KEY` set as a **sensitive** env var on Vercel project `tcg-buy-calculator` (Production + Preview) on 2026-10-10.
- Server-side gate: `lib/pricing-authorization.js`; `/api/cards` serves no pricing unless it evaluates as authorized. `data/config.json` mirrors it (enforced by tests).

Restrictions that still apply: do not proxy or re-expose JustTCG endpoints for third-party querying, do not redistribute or export raw data, and present JustTCG prices as market observations, not quotes. `/api/cards` returns only normalized fields, refuses cross-site browser requests, caps provider calls per search, and is CDN-cached for five minutes to protect the 1,000-requests/day Starter quota.

This is a reading of published terms, not legal advice. Have an attorney confirm before relying on it for a commercial launch if the business needs certainty.

## Implemented

- Server-side `JUSTTCG_API_KEY` adapter.
- `x-api-key` authentication.
- `/games`, `/sets`, `/cards` pagination and batch lookup.
- Card, set, game, variant condition, price, source, and timestamp normalization.
- Non-negative numeric-price validation.
- Freshness metadata from JustTCG `lastUpdated` timestamps.
- JustTCG-only production provider selection with no TCGCSV fallback.
- Condition-neutral policy preserved at 100% for all five conditions.
- Existing 60% buy-rate calculation preserved.
- Existing authenticated, transactional Supabase publication path preserved.

## Open items

1. Rotate the JustTCG key (it was shared in a chat log) and update the Vercel env var.
2. Watch daily quota (1,000/day on Starter); upgrade to Professional (5,000/day) if customers hit the limit.
3. The indexed Supabase catalog holds only part of the catalog and is not enabled on Vercel; customer search uses the live provider.
