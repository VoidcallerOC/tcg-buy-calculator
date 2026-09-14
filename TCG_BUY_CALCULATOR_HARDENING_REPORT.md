# TCG BUY CALCULATOR HARDENING REPORT

## OVERALL VERDICT

**🟡 SOLID FOUNDATION — PRICING/BACKEND REQUIRED**

The repository is a trustworthy static MVP foundation, but it must not be treated as a live pricing or buying system until an authorized pricing source and authenticated server-side publishing boundary exist.

## CURRENT SCORE

| Area                  |    Score | Assessment                                                                                          |
| --------------------- | -------: | --------------------------------------------------------------------------------------------------- |
| Architecture          |     9/10 | Small, reusable static architecture preserved.                                                      |
| Calculation Engine    |     9/10 | Integer cents, basis points, safe-range validation, and explicit rounding.                          |
| Business Logic        |     8/10 | Configurable rate and explicit condition selection; future rule extension points remain documented. |
| Pricing Model         |     5/10 | Honest sample dataset with metadata, but no authorized live provider.                               |
| Data Safety           |     9/10 | CSV validation, duplicate detection, non-destructive preview, and safe rendering.                   |
| Security              |     9/10 | No committed secrets; imported values no longer reach dynamic HTML.                                 |
| Testing               |     8/10 | Unit edge cases and browser customer flow pass.                                                     |
| UX                    |     8/10 | Clear search, condition, estimate, unavailable state, and disclaimers.                              |
| White-Label Readiness |     9/10 | Client configuration remains data-driven and reusable.                                              |
| Production Readiness  |     6/10 | Static foundation is strong; pricing, persistence, auth, and server authority remain.               |
| **Overall**           | **8/10** | **Solid foundation, not yet live-production ready.**                                                |

## WHAT WAS ALREADY SOLID

The repository already had a focused static architecture, reusable white-label configuration, an integer-cent calculation model, deterministic card search, explicit condition controls, a safe unavailable-pricing state, a CSV parser with duplicate-row protection, a preview-only admin workflow, clear sample-data disclaimers, and a useful documentation structure. The Hard Hittin configuration and 60% buy rate were preserved.

## WHAT YOU CHANGED

The money module now validates negative, malformed, over-precise, and oversized values, uses `BigInt` for intermediate offer multiplication, enforces safe integer ranges, and retains nearest-cent rounding. Pricing lookup now throws on multiple active records for the same card and condition instead of silently taking the first record. The customer and admin interfaces now render imported or dataset values through safe DOM APIs rather than `innerHTML`. CSV validation now rejects missing required values, malformed dates, invalid prices, invalid conditions, duplicate rows, and malformed quoted fields. The sample dataset now records explicit development-only status and source/update/import metadata. Documentation was corrected and expanded around the current MVP boundary, freshness, uniqueness, security, deployment, and future backend requirements.

## TESTS ADDED

Unit coverage now includes `$0.00`, `$0.01`, `$0.99`, `$19.99`, `$100.00`, 0%, 100%, rounding, malformed and negative money, invalid percentages, oversized values, search by name/number/set code/set name, whitespace and no-result search, inactive pricing, missing pricing, duplicate active pricing, CSV required fields, dates, duplicate rows, quoted malicious-looking text, malformed prices, malformed conditions, and the non-destructive preview behavior.

## TEST RESULTS

- `npm test`: **passed** — Prettier check passed and 6 unit tests passed.
- `npm run test:browser`: **passed** — 2 Playwright customer-flow tests passed.
- The initial test attempts were blocked only by missing local npm dependencies and the Playwright browser runtime; the declared dependencies and Chromium runtime were installed, then both suites passed.

## SECURITY RESULTS

No API keys, credentials, tokens, or secrets were found in tracked project files. No fake live pricing integration was introduced. The remaining application dynamic rendering uses safe DOM APIs; imported card names, set names, source names, and parser error text are inserted as text nodes. CSV values are treated as untrusted. The static admin page does not claim authentication or persistence.

## PRODUCTION BLOCKERS

1. An authorized pricing provider or maintained internal pricing dataset must be selected and integrated.
2. Pricing freshness policy, stale-data behavior, source authorization, and failure handling must be enforced at the provider/server boundary.
3. Production imports require an authenticated and authorized admin endpoint with server-side revalidation, transactional upserts, uniqueness constraints, history, versioning, rollback, audit logging, and safe publishing.
4. Authoritative production configuration, pricing, and calculation inputs should not rely solely on mutable client-side static assets.

## INTENTIONALLY NOT BUILT

No backend, database, authentication system, pricing scraper, fake API, real-time claim, client-specific fork, or unnecessary framework was added. The preview page remains preview-only because persistence and access control would require a real server boundary.

## PRICING DEPENDENCY

Before this becomes a live pricing/buying system, Forge-CT needs a legally authorized source with documented access rights, update cadence, source metadata, freshness timestamps, dataset versioning, and a defined stale-data policy. The source must feed a server-side validated import pipeline; sample records must be replaced, not rebranded as live data.

## FINAL ANSWER

**Would I trust this repository as the foundation for a real multi-client TCG buy calculator? YES.**

I would trust it as a small, reusable engineering foundation because the calculation, lookup, configuration, CSV, preview, and UI boundaries are clear and now safer against malformed data, duplicate pricing, and HTML injection. I would not trust the current static sample dataset to produce authoritative live offers until the documented pricing and backend requirements are implemented.
