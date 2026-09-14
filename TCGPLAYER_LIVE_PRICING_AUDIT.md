# TCG BUY CALCULATOR — LIVE PRICING AUDIT

## Provider

TCGplayer official API only.

## Authorization

**NOT CONFIGURED**

No `TCGPLAYER_PUBLIC_KEY` or `TCGPLAYER_PRIVATE_KEY` exists in the current environment. The deployed `tcgplayer-sync` Supabase Edge Function intentionally reports `TCGplayer provider not configured` and does not claim live pricing.

## Current Week

No live sync was run because authorized access is not available.

## Categories

| Status       |             Count |
| ------------ | ----------------: |
| Discovered   | 0 live categories |
| Authorized   |                 0 |
| Synchronized |                 0 |
| Failed       |                 0 |
| Unavailable  |                 0 |

No category is claimed as supported or synchronized without an authorized provider response.

## Products and pricing records

- Live products synchronized: **0**
- Live pricing records synchronized: **0**
- Current: **0**
- Stale: **0**
- Unavailable: **0**
- Failed: **0**

The production Supabase schema contains no fabricated TCGplayer pricing rows. The checked-in browser configuration remains in explicit sample mode.

## Implementation completed

The repository now contains a credential-gated official provider adapter, OAuth client-credentials authentication, dynamic category discovery, paginated group/product discovery, bounded pricing batches, retry/backoff handling for 429 and 5xx responses, explicit condition mapping, market-price-only selection, deterministic freshness classification, category-level partial-failure reporting, sync metadata persistence, and deterministic fixtures/tests.

The provider boundary never scrapes TCGplayer web pages, uses browser automation, calls unofficial endpoints, or accepts third-party scraped data. Private credentials remain server-side. The admin dashboard reports provider status after authentication.

## Tests

- `npm test`: **PASS** — formatting, existing calculator tests, provider normalization, authentication gating, pagination, retry behavior, freshness, and partial sync tests.
- `npm run test:browser`: **PASS** — existing sample-mode customer flow tests.
- Supabase migration for sync metadata: **APPLIED**.
- Supabase Edge Function `tcgplayer-sync`: **ACTIVE**, JWT protected, explicitly `NOT_CONFIGURED` without secrets.
- Vercel deployment: **READY**.

## Security

**PASS**. No provider secret is in frontend code or committed configuration. The provider requires credentials before construction. The Edge Function requires JWT authentication. No scraping or unofficial API usage exists.

## Compliance

**READY — ACCESS PENDING**. The adapter follows the official OAuth/catalog/pricing boundary documented by TCGplayer. Any production use still requires confirming the shop’s authorized access and applying the terms, attribution, and source-link requirements of that access agreement. The application must not imply TCGplayer endorsement or certification.

## Production Status

**🟡 READY — CREDENTIALS/DATA ACCESS PENDING**

The software is ready to accept authorized access, but it is not live and must not be represented as live.

## Remaining Blocker

Authorized TCGplayer API access is the only blocker to live TCGplayer synchronization. A real admin Auth account is also required to operate the existing protected admin workflow.

## Exact Next Action

Supply authorized TCGplayer API access and configure the server-side Supabase Edge Function secrets `TCGPLAYER_PUBLIC_KEY` and `TCGPLAYER_PRIVATE_KEY`; then run the authenticated sync preview before publishing.

> Live TCGplayer synchronization cannot be enabled until authorized TCGplayer API access is supplied.
