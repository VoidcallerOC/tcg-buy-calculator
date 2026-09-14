# HARD HITTIN TCG BUY CALCULATOR

## Final Production Status

**YELLOW — SOFTWARE COMPLETE / PROVIDER ACTIVATION REQUIRED**

JustTCG is now the intended production provider. Its official paid-tier terms permit end-user display, derived analytics, and server-side caching, while prohibiting raw-data redistribution and API substitution. The server-side `JUSTTCG_API_KEY` is now configured in Supabase Edge Function Secrets, but the paid plan and controlled production verification remain unresolved.

The software, Hard Hittin configuration, condition-neutral online policy, calculator math, provider boundary, Supabase schema, authentication boundary, transactional publishing path, category classification, freshness handling, and automated tests are implemented. Production pricing activation remains blocked because TCGCSV commercial-use, derived-pricing redistribution, and attribution authorization are unresolved. This is an external blocker, not a coding failure.

## Client

Hard Hittin Card Shop (`hard-hittin`).

## Buy Rate

The configured client buy rate is **60%**, stored as 6,000 basis points in the client configuration. It is not a TCGCSV field and is not hard-coded into the provider.

## Condition Policy

| Condition | Online reference policy | Status   |
| --------- | ----------------------- | -------- |
| NM        | 100% market reference   | APPROVED |
| LP        | 100% market reference   | APPROVED |
| MP        | 100% market reference   | APPROVED |
| HP        | 100% market reference   | APPROVED |
| DMG       | 100% market reference   | APPROVED |

Policy version: **1.0**. Effective date: **2026-09-14**. Approver: **Hard Hittin**.

This is a **condition-neutral online estimate**. The final offer remains subject to physical inspection, condition, authenticity, printing/edition, demand, inventory, and shop policy. The TCGCSV market reference is not represented as an NM, LP, MP, HP, or DMG price.

## Provider

| Item                                          | Status                                               |
| --------------------------------------------- | ---------------------------------------------------- |
| Provider                                      | TCGCSV                                               |
| Provider implementation                       | PASS                                                 |
| Server-side endpoints and pacing              | PASS                                                 |
| Category, group, product, and price discovery | Implemented and fixture-tested                       |
| Market reference                              | `marketPrice`, retained as a source market reference |
| Commercial-use status                         | **UNCLEAR**                                          |
| Derived-price redistribution                  | **UNCLEAR**                                          |
| Attribution requirements                      | **UNCLEAR**                                          |
| Overall external authorization                | **PENDING**                                          |
| Production publication                        | **BLOCKED**                                          |

The current official TCGCSV documentation supports server-side processing and database/cache ingestion, with daily polling, descriptive User-Agent requirements, 100 ms pacing, and a 10,000-request ceiling. It does not provide clear commercial-use or derived-price redistribution permission for this calculator.

## Data and Database

| Item                                  | Result                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Categories discovered                 | 94 in the prior verified discovery                                                            |
| Category classification               | Implemented; only `CARD_GAME` enters the card catalog                                         |
| Products and pricing                  | No authorized production sync published                                                       |
| Current / aging / stale / unavailable | Freshness model implemented; production counts unavailable because no production sync was run |
| Failed categories                     | Failure-preserving sync logic and reporting implemented and tested                            |
| Supabase schema                       | PASS — existing production architecture preserved                                             |
| Pricing history                       | PASS — existing transactional history preserved                                               |
| RLS                                   | PASS — existing policies preserved                                                            |
| Production records                    | Not verified as populated for TCGCSV                                                          |

## Admin

Authentication, client authorization, CSV validation, transactional publish, policy visibility, and provider status are implemented. The repository does not claim that the current status endpoint is a completed production sync or preview. No publish action was performed because the commercial-use gate remains blocked.

## Customer

The customer path is verified in sample mode and preserves strict sample/production separation. It supports card search, card selection, condition selection, market-reference display, configured 60% buy rate, integer-cent estimated offers, freshness messaging, unavailable states, and the final-offer disclaimer. Production mode reads Supabase only and never falls back to sample pricing.

## Tests

- `npm test`: **PASS — 17 tests**.
- `npm run test:browser`: **PASS — 2 tests**.
- Prettier check: **PASS**.
- `git diff --check`: **PASS**.

## Security

**PASS for the implemented boundary.** Provider access is server-side, no provider secrets are shipped to the browser, Supabase RLS and authenticated admin authorization remain active, DOM output uses text assignment, inputs are validated, duplicate active pricing is constrained, and transactional publishing preserves prior state on failure.

## Deployment

The repository remains a Vercel-compatible static frontend with Supabase-backed production architecture. A GREEN deployment and customer production verification cannot be claimed because no authorized production dataset was published and no current production URL verification was performed in this run.

## Remaining Blockers

### Technical blockers

No newly identified technical blocker prevents the configured sample-mode application and its tested production boundary from operating as designed.

### External/business blockers

1. Obtain written TCGCSV authorization for commercial use of the data in this calculator.
2. Obtain explicit authorization for serving derived pricing to calculator users.
3. Obtain attribution requirements or confirmation that no additional attribution is required.
4. Assign the real Hard Hittin administrator and publish an authorized production dataset after the permission evidence is recorded.

The manual request is documented in [`docs/TCGCSV_AUTHORIZATION_REQUEST.md`](docs/TCGCSV_AUTHORIZATION_REQUEST.md), including the official GitHub Issues and Discord channels. The connected GitHub integration’s inability to create an external issue is recorded as a permission limitation, not a calculator defect.

## Exact Next Action

Obtain written TCGCSV commercial-use, derived-pricing redistribution, and attribution authorization. Then run one server-side sync preview, review it, and publish only through the existing transactional Supabase path.

## References

[1]: https://tcgcsv.com/docs "TCGCSV Documentation"
[2]: https://tcgcsv.com/faq "TCGCSV Frequently Asked Questions"
