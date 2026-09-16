# Hard Hittin TCG Buy Calculator Verification Report

## Status

**YELLOW.** The customer-facing calculator flow is functionally covered and passes the repository’s unit and browser regression suites. The verified production domain is serving, but the live JustTCG endpoint currently returns HTTP 503 because the production deployment does not have `JUSTTCG_API_KEY` configured. Therefore, the real Mihawk-to-offer acceptance journey cannot yet be claimed as live-verified.

## What Was Broken

The live card adapter accepted only a narrow subset of provider data and did not robustly normalize timestamps or malformed variants. The frontend could treat stale reference prices as usable, and selected search results were removed from the DOM immediately after selection, making the active choice less visible and harder to inspect. Keyboard focus styling and touch-target sizing were also incomplete.

The first accessibility patch temporarily assigned `role="radio"` to native buttons. That changed their accessible role and broke existing browser locators. The regression was corrected by preserving native button semantics and using the existing `aria-pressed` state instead.

## What Was Fixed

| File           | Changes                                                                                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/cards.js` | Added resilient provider-data normalization, safe timestamp normalization for Unix and ISO values, malformed-variant skipping, explicit invalid-response handling, request timeout handling, whitespace normalization, and continued server-only API-key use.         |
| `app.js`       | Added stale-price rejection honoring `stale_threshold_days` and `allow_stale_pricing`; made stale/unavailable states explicit; retained selected result cards with visible selected state; added accessible pressed-state updates; preserved native button semantics. |
| `styles.css`   | Added visible keyboard focus rings and a minimum touch target for condition controls without changing the approved visual system.                                                                                                                                     |

No unsafe HTML rendering was introduced. Provider values continue to be rendered through `textContent` and created DOM nodes.

## Live JustTCG Test

The production smoke request was:

`GET https://buy.hardhittincardshop.com/api/cards?q=Mihawk`

Result: **HTTP 503 — Live pricing provider is not configured.** No real cards, reference price, condition, or offer were returned. This is reported honestly; no sample card or fabricated offer was used as a fallback.

The local sandbox also had no `JUSTTCG_API_KEY` environment variable, so a direct live provider request could not be performed there.

## Test Results

| Check                  | Result                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `npm test`             | **PASS** — formatting and all 26 unit/API tests passed.                                                                       |
| `npm run test:browser` | **PASS** — all 3 browser tests passed, including the narrow mobile journey.                                                   |
| Build                  | **N/A** — `package.json` defines no build script; this is a static Vercel-compatible application with a serverless API route. |
| `git diff --check`     | **PASS**                                                                                                                      |

The browser tests cover search, selection, condition selection, 60% cent-based calculation, unavailable pricing, and 390px mobile layout. They use deterministic route fixtures and do not prove live-provider availability.

## Production

Vercel inspection confirmed the linked project `tcg-buy-calculator` has a latest production deployment in `READY` state and includes these domains:

- `https://buy.hardhittincardshop.com/`
- `https://tcg-buy-calculator.vercel.app/`

The custom domain responded with HTTP 200. The latest verified deployment predates these local changes, so the changed files still need to be committed and deployed before the fixes are present in production.

## Security

- The JustTCG API key is read server-side from `process.env.JUSTTCG_API_KEY` only.
- The browser bundle contains only the first-party `/api/cards` path; it does not contain the provider key, `x-api-key`, or the JustTCG API hostname.
- Provider data is rendered safely with DOM APIs and `textContent`.
- Query input is trimmed, length-validated, URL-encoded by the browser, and interpreted server-side.
- No known XSS or privileged credential exposure was introduced.

## Remaining Blockers

### Technical blockers

1. Configure `JUSTTCG_API_KEY` as a production Vercel environment variable for the `tcg-buy-calculator` project.
2. Deploy the changed repository state.
3. Repeat the live Mihawk smoke test, select a real returned card, select NM, calculate, and verify the returned reference price and 60% offer on desktop and mobile.

### Commercial/licensing blockers

The repository configuration continues to distinguish live provider testing from commercial activation. No commercial activation was claimed or added as a technical blocker.
