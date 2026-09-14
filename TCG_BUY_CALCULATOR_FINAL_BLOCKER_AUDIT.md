# TCG BUY CALCULATOR — FINAL BLOCKER AUDIT

## Conclusion

The calculator is **YELLOW — READY BUT OPERATIONAL INPUT REQUIRED**, with production synchronization deliberately **BLOCKED**. Hard Hittin's approved 60% buy rate and condition-neutral online policy are configured. The repository distinguishes a TCGCSV market reference from the shop policy and buy rate. It does not claim that TCGCSV grants commercial-use permission.

## TCGCSV

| Issue                          | Result                | Evidence or implementation                                                                                                                                                                |
| ------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider                       | IMPLEMENTED           | Documented JSON endpoints, server-side requests, descriptive User-Agent, pacing, retries, freshness, and explicit variation mapping remain in `lib/tcgcsv-provider.js`.                   |
| Documentation                  | VERIFIED              | Current official documentation and FAQ were reviewed on 2026-09-14.                                                                                                                       |
| Commercial use                 | UNCLEAR               | The official pages describe processing cached JSON/CSV files but do not grant a commercial-use license for this application.                                                              |
| Derived pricing redistribution | UNCLEAR               | No explicit permission was found for serving derived pricing to calculator users.                                                                                                         |
| Attribution                    | UNCLEAR               | No clear attribution requirement or waiver was found.                                                                                                                                     |
| Rate limits                    | SUPPORTED WITH LIMITS | Check `last-updated.txt` first, sync no more than once per 24 hours, use a descriptive User-Agent, include at least 100 ms between requests, and stay under 10,000 requests per 24 hours. |
| Caching/storage                | SUPPORTED             | The documentation directs server-side applications to ingest data into their own database or cache.                                                                                       |
| Browser scraping               | NOT SUPPORTED         | The documentation says CORS is restrictive and directs integrations to server-side applications.                                                                                          |

The code therefore records `tcgcsv_commercial_use_status: UNCLEAR`, `tcgcsv_derived_pricing_status: UNCLEAR`, and keeps production blocked. Written permission or clarification from the data maintainer is required before publication.

## Condition Policy

The policy model is configurable and versioned. Hard Hittin approved a **condition-neutral online estimate** effective 2026-09-14, version 1.0. NM, LP, MP, HP, and DMG each use a 100% market-reference multiplier. This is a shop policy, not condition-specific TCGCSV pricing. Physical inspection and shop policy determine the final offer.

TCGCSV `marketPrice` remains a **market reference**. It is not labeled as an NM, LP, MP, HP, or DMG price. The approved policy applies the same market reference across selected conditions before the 60% Hard Hittin buy rate is applied.

## Catalog

The previous source discovery identified 94 categories. The new classification layer preserves discovery but limits the calculator catalog to categories classified as `CARD_GAME`; supplies, accessories, non-card games, books, miniatures, and other categories remain outside the card-pricing catalog. No full production category sync was run because the commercial-use gate and policy gate are not satisfied.

## Production Sync

| State               | Result                                                            |
| ------------------- | ----------------------------------------------------------------- |
| Sync status         | NOT RUN                                                           |
| Publication         | BLOCKED                                                           |
| Sample mode         | Preserved and available for development/browser tests             |
| Production fallback | None; missing production data is reported as pricing unavailable  |
| Failure safety      | Existing provider and transactional publish path remain unchanged |

The explicit readiness gate requires commercial-use confirmation, attribution resolution, approved condition policy, provider reachability, category discovery, catalog validation, pricing validation, Supabase configuration, and admin authorization. A UI toggle cannot bypass these checks.

## Tests

`npm test` includes the existing calculator, provider, and CSV tests plus blocker-resolution tests for unconfigured and approved policies, cent rounding, category classification, commercial permission gating, production readiness, and live-state evaluation. `npm run test:browser` continues to cover the sample-mode customer flow.

## Production Readiness

**YELLOW — READY BUT OPERATIONAL INPUT REQUIRED**, with the current production sync status **RED — BLOCKED**.

## Remaining Blockers

1. Obtain written commercial-use and derived-pricing redistribution confirmation from the TCGCSV maintainer, including attribution requirements.
2. After that confirmation, run a server-side sync preview, validate card-game categories and pricing, obtain explicit publish confirmation, and publish through the existing transaction.

## Exact Next Action

Obtain written TCGCSV commercial-use/derived-pricing permission and attribution clarification; do not publish the production sync before it is recorded.

## References

[1]: https://tcgcsv.com/docs "TCGCSV Documentation"
[2]: https://tcgcsv.com/faq "TCGCSV Frequently Asked Questions"
