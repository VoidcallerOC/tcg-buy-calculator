# TCG BUY CALCULATOR & SCANNER — NUKE AUDIT, PHASE ZERO BASELINE

Audit date: 2026-10-11 (UTC). Mode: read-only. No code, production configuration, database, or deployment was changed. The only production calls were GET requests, two no-op RPC calls (empty input; no rows touched), and read-only SQL.

## A. Executive verdict

**Overall status: PARTIAL.** Phase Zero (baseline) is done. Phases 1–10 are only partly verified. The application is **not production-ready**.

| Question                                    | Answer                                                                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Current production build identified?        | **Yes.** `tcg-buy-calculator.vercel.app` serves `dpl_6hCBGWKNn4gVJ6uuiM2bHpM1yvk1`, commit `bd3446f` (PR #7). It does **not** serve `main` HEAD `aede41c` (PR #10).                                                |
| Scanner tested end to end?                  | **Partly.** Real OCR ran in automated Chromium against a fake camera (45/45 browser tests pass, but those tests mock `/api/cards` and Supabase). It was not tested end to end against production.                  |
| Physical device tested?                     | **No.** No phone was available. All real-device results are UNVERIFIED.                                                                                                                                            |
| Pricing calculations independently checked? | **Yes, at the engine level.** 16/16 valid inputs matched an independent Decimal ROUND_HALF_UP calculation; 7/7 malformed inputs were rejected; a multi-card total matched. Live printing separation was confirmed. |
| Admin publishing and database checked?      | **Yes — and admin publishing is broken.** The publish function does not exist in the production database, there are 0 auth users and 0 admins, and the `default` client row is missing.                            |
| Most serious confirmed finding              | **F-01:** anonymous users can call a SECURITY DEFINER function (`tcg_catalog_publish_prices`) that writes active catalog prices and bypasses RLS.                                                                  |
| Most important unresolved blocker           | **F-02:** production is pinned to PR #7. PRs #8–#10 (multi-card list, misread correction, AI fallback, early-input fix) are merged and deployed READY but are not live.                                            |

Stack note: the brief says "Nitro". This repository has no Nitro. It is static HTML/CSS/ES modules, Vercel Node functions in `api/`, and Supabase. That stack was kept as-is for this audit.

## B. Evidence matrix

| Criterion                                         | Repository evidence                                 | Production evidence                                                                                                                      | Test performed                                                   | Result           | Confidence                                                       | Next action                                       |
| ------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| Production runs `main` HEAD                       | HEAD `aede41c`                                      | Alias → `dpl_6hCB…` / `bd3446f`; cache-busted `/` and `/app.js` match `bd3446f`; `/api/identify` returns 404                             | Byte compare of served files vs git commits; Vercel alias lookup | **Fail**         | High                                                             | Promote `dpl_6YSVztGQNCuGgg2tLjKSJnR1WZPj` (F-02) |
| Offer = 60% of reference, half-up cents           | `lib/money.js` `calculateOffer`                     | Same file served (byte-identical)                                                                                                        | Independent Python Decimal matrix (section E)                    | Pass             | High (engine)                                                    | None                                              |
| List total = sum of priced lines; unpriced listed | `lib/offer-list.js`                                 | Not live (PR #8 not deployed)                                                                                                            | Node + Python check                                              | Pass (repo only) | High (repo) / not in production                                  | Goes live with F-02                               |
| Printing-specific prices; no substitution         | `api/cards.js` `normalizeCard`                      | Live `4/102`: Base Set Holofoil NM $928.32; Shadowless printings null; Celebrations $140.76                                              | Live GET                                                         | Pass             | High                                                             | None                                              |
| Stale/undated price never priced                  | `app.js` `pricingState` (7 days)                    | Live prices dated 2026-10-10                                                                                                             | Code review + browser tests (mocked)                             | Pass             | Medium (no live stale sample)                                    | None                                              |
| Scan result needs confirmation                    | `scanner/catalog-matcher.js`, `scanner-ui.js`       | Old build live                                                                                                                           | Code review + e2e (fake camera, real OCR)                        | Pass             | Medium                                                           | Phone test                                        |
| Camera released on close                          | `camera-capture.js` `stop`                          | —                                                                                                                                        | Browser test (open/close/Escape)                                 | Pass (Chromium)  | Medium                                                           | Phone test incl. backgrounding (F-09)             |
| Real-phone camera                                 | —                                                   | —                                                                                                                                        | None                                                             | **Not Tested**   | None                                                             | iOS Safari + Android Chrome run                   |
| OCR accuracy on a labeled set                     | —                                                   | —                                                                                                                                        | None — no labeled image set exists                               | **Not Tested**   | None                                                             | Build a 30–50 card labeled set                    |
| Admin can publish CSV                             | `admin/admin.js` calls `tcg_publish_pricing_import` | RPC returns PGRST202 (function missing); 0 users; no `default` client; `tcg_source_compliance` / `tcg_condition_policies` tables missing | Read-only SQL + no-op REST call                                  | **Fail**         | High                                                             | F-03 product decision                             |
| Unauthorized user cannot write pricing            | RLS select-only policies                            | Direct table writes blocked by RLS; **`tcg_catalog_publish_prices` callable by anon**                                                    | Privilege SQL + no-op anon RPC (HTTP 200)                        | **Fail**         | High                                                             | F-01 revoke                                       |
| No secrets in client or git history               | —                                                   | Served bundles: 0 hits                                                                                                                   | Pattern scan of 47 commits + served files                        | Pass             | Medium (pattern scan, not exhaustive)                            | None                                              |
| JustTCG key rotated                               | Docs list as open                                   | `JUSTTCG_API_KEY` `createdAt` == `updatedAt` (2026-10-10T19:18:40Z), `updatedBy` null; live searches succeed with the current key        | Vercel env metadata (value not read)                             | **Fail / open**  | High that the Vercel value never changed; rotation not evidenced | F-04 rotate                                       |
| `/api/cards` not a third-party proxy              | `sec-fetch-site` check                              | curl without the header → 200; cross-site → 403 on MISS, **200 on CDN HIT**                                                              | Live GET sequence                                                | **Fail**         | High                                                             | F-05                                              |

## C. Findings register (confirmed, by severity)

| ID   | Pri | Sev    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                                                                            |
| ---- | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | P1  | High   | `public.tcg_catalog_publish_prices(jsonb)` is SECURITY DEFINER and executable by `anon` and `authenticated` (ACL `anon=X`). The migration's `revoke all … from public` does not remove Supabase's default `anon`/`authenticated` grants. Anyone holding the public publishable key (served in `data/config.json`) can deactivate and insert active catalog prices for any variant. No customer impact today: Vercel has no `SUPABASE_URL`/`SUPABASE_ANON_KEY`, so `/api/cards` uses `source: "provider"`. **This becomes P0 the moment the indexed catalog is enabled.**                                            | `has_function_privilege('anon',…)=true`; Supabase advisor `anon_security_definer_function_executable`; anon `POST /rest/v1/rpc/tcg_catalog_publish_prices {"p_prices":[]}` → `0`, HTTP 200 (no-op). |
| F-02 | P1  | High   | The production domain is pinned to PR #7 (`bd3446f`, deployed 2026-10-10T20:11Z). Later production deployments for #8 (`dpl_6Az9…`), #9 (`dpl_4XA3…`), and #10 (`dpl_6YSV…`) are READY but not aliased. Customers do not get the multi-card list, misread correction, AI fallback, or early-input fix. Any claim that these are "live" is false. Likely cause: a manual promote/rollback around 2026-10-10T20:41Z (project `updatedAt`) turned off production auto-assignment — **cause UNVERIFIED**.                                                                                                               | `get_deployment(tcg-buy-calculator.vercel.app)` → `dpl_6hCBGWKNn4gVJ6uuiM2bHpM1yvk1`; byte matches to `bd3446f`; `/api/identify` → 404.                                                             |
| F-03 | P2  | Medium | The admin publishing path cannot work, and it would not affect customers even if it did. (a) `tcg_publish_pricing_import` does not exist in the DB. (b) Only 3 of 7 repo migrations are applied (`tcg_sync_runs`, `tcg_source_compliance`, `tcg_condition_policies`, and the debrand migration are missing). (c) The only client row is `hard-hittin`; the app uses `client_id: "default"`, so sign-in fails with "Production readiness configuration is incomplete." (d) 0 auth users, 0 `tcg_client_admins`. (e) `app.js` never reads `tcg_pricing`, so a successful publish would not change any customer price. | Read-only SQL; PGRST202 on RPC; PGRST205 on `tcg_source_compliance`; `grep` of `app.js`.                                                                                                            |
| F-04 | P1  | High   | The JustTCG key reported as exposed in a chat log has not been rotated in Vercel. Live searches still succeed, so the current key is still valid at the provider.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Env metadata above. The value was not decrypted.                                                                                                                                                    |
| F-05 | P2  | Medium | `/api/cards` origin guard is bypassable. (a) Non-browser clients send no `Sec-Fetch-Site` header and get full normalized JustTCG pricing. (b) The CDN cache key ignores `Sec-Fetch-Site`, so cross-site browser requests get 200 on a cache HIT. There is no rate limit. Each uncached search spends up to 4 provider calls of a 1,000/day Starter quota (about 250 unique searches exhausts it), which would stop all customer pricing for the day. It also conflicts with the JustTCG "do not re-expose" restriction cited in `lib/pricing-authorization.js`.                                                     | Live sequence: cross-site MISS → 403, plain → 200, cross-site HIT → 200.                                                                                                                            |
| F-06 | P2  | Medium | The `Full catalog sync` GitHub workflow fails daily: 8 of 8 recent scheduled runs (Oct 3–10) failed with JustTCG HTTP 429 on the first call (`getGames`). If it uses the same key as Vercel, it competes with customer quota. If it uses a different key, that key's identity is unknown (it may be the exposed one). The indexed catalog it feeds is stale (latest price 2026-09-25) and unused in production.                                                                                                                                                                                                     | Run `38043079426` log.                                                                                                                                                                              |
| F-07 | P2  | Medium | Policy and implementation disagree on money. README and `data/condition-policy.json` say the approved v1.0 policy is condition-neutral (the same reference for NM–DMG). Live pricing is condition-specific: Charizard Arceus Holofoil NM $106.39 vs LP $59.00 vs DMG $16.26, so offers differ by condition. The live behavior is arguably more accurate, but it is not what the approved policy and disclaimer describe. Owner decision needed.                                                                                                                                                                     | Live `/api/cards?q=charizard`; `app.js` uses `pricing[condition]` directly.                                                                                                                         |
| F-08 | P2  | Medium | Same-date CSV correction fails (affects the admin path only). Re-importing a changed price with the same `source_updated_at` deactivates the active row, then violates `unique(client_id, card_id, condition_code, source_updated_at)`, so the import rolls back. Failed imports are never recorded either, because the `tcg_imports` row rolls back with the exception.                                                                                                                                                                                                                                            | `supabase/migrations/20260914210000_tcg_calculator.sql`.                                                                                                                                            |

Suspected risks (unverified, code-level only):

- **F-09 (P2, UNVERIFIED):** returning from background on iOS. `CameraCapture.start` reuses `this.stream` without checking `track.readyState`, and there is no `ended`/`visibilitychange` handler. On iOS, where tracks end on backgrounding, "Scan again" may show a black feed until the dialog is closed and reopened. Needs a phone test.
- **F-10 (P3):** the scanner shows at most 5 candidates and does not say more exist (live `OP05-119` returned 10 printings). Manual search shows 12 and says when there are more.
- **F-11 (P3, latent):** `/api/identify` (PR #9) has the same guard weakness as F-05 plus model cost. It is not live: not deployed, and there is no `ANTHROPIC_API_KEY` on Vercel.
- **F-12 (P3):** a future-dated `source_updated_at` counts as fresh in `pricingState`.

## D. Scanner test matrix

| Test case                                         | Device / browser                 | Scenario                      | Expected                                            | Actual                                    | Status            |
| ------------------------------------------------- | -------------------------------- | ----------------------------- | --------------------------------------------------- | ----------------------------------------- | ----------------- |
| Real OCR → confirm printing → 60% offer           | Playwright Chromium, fake camera | Printed card image            | Candidate shown, user confirms, correct offer       | As expected                               | Pass (mocked API) |
| Unreadable card                                   | Same                             | Blank / blurred               | Not identified, manual fallback, camera released    | As expected                               | Pass              |
| Misread → correct number → match                  | Same                             | OCR digit swap                | Corrected search finds card                         | As expected (repo; not live)              | Pass (repo)       |
| Camera denied                                     | Same                             | `NotAllowedError`             | Honest error + manual search                        | As expected                               | Pass              |
| Open/close/Escape × N                             | Same                             | Lifecycle                     | Tracks stopped, focus restored                      | As expected                               | Pass              |
| Live number lookup `4/102` (Pokémon)              | curl → production                | Multiple printings            | All printings, separate prices, null where unpriced | 10 results, separate prices, nulls        | Pass              |
| Live number lookup `OP05-119` (One Piece)         | curl → production                | 10 printings incl. $13,000 SP | Separate prices                                     | 10 results, separate prices               | Pass              |
| iOS Safari rear camera, glare, sleeves, low light | —                                | —                             | —                                                   | —                                         | **Not Tested**    |
| Android Chrome                                    | —                                | —                             | —                                                   | —                                         | **Not Tested**    |
| Background → return                               | —                                | F-09                          | Live feed resumes                                   | —                                         | **Not Tested**    |
| Labeled accuracy set                              | —                                | —                             | Measured hit rate                                   | No set exists; no accuracy figure claimed | **Not Started**   |

## E. Pricing and data-integrity matrix

Engine: `lib/money.js` `calculateOffer(cents, 6000)`. Independent check: Python `Decimal(cents) * 0.6`, ROUND_HALF_UP to whole cents.

| Input                                | Cents   | Engine offer | Independent | Result |
| ------------------------------------ | ------- | ------------ | ----------- | ------ |
| 0                                    | 0       | 0            | 0           | Pass   |
| 0.01                                 | 1       | 1            | 1           | Pass   |
| 0.02                                 | 2       | 1            | 1           | Pass   |
| 0.03                                 | 3       | 2            | 2           | Pass   |
| 0.05                                 | 5       | 3            | 3           | Pass   |
| 0.99                                 | 99      | 59           | 59          | Pass   |
| 1.00                                 | 100     | 60           | 60          | Pass   |
| 1.15                                 | 115     | 69           | 69          | Pass   |
| 16.26                                | 1626    | 976          | 976         | Pass   |
| 19.89                                | 1989    | 1193         | 1193        | Pass   |
| 37.72                                | 3772    | 2263         | 2263        | Pass   |
| 59.00                                | 5900    | 3540         | 3540        | Pass   |
| 106.39                               | 10639   | 6383         | 6383        | Pass   |
| 1234.57                              | 123457  | 74074        | 74074       | Pass   |
| 99999.99                             | 9999999 | 5999999      | 5999999     | Pass   |
| 10.639, 1.005, -1, abc, 1e3, NaN, "" | —       | rejected     | rejected    | Pass   |

List (repo, PR #8): 10639 + 5900 + 3772 priced + 1 unpriced → offer total 12186 = 6383 + 3540 + 2263; `unpriced: 1`. Pass.

Live source: JustTCG, `source_updated_at` 2026-10-10 on all sampled prices, so fresh within the 7-day threshold. Provider prices arrive as decimals and are converted with `Math.round(price * 100)`; this is safe for 2-decimal inputs.

CSV → DB field mapping (admin path; F-03 makes it non-functional in production):

| CSV field            | App field (`csv-import.js`)    | DB column                              | Type       | Observed                                                                 |
| -------------------- | ------------------------------ | -------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| card_name            | card_name                      | tcg_cards.name                         | text       | Repo only — RPC missing in DB                                            |
| set_name             | set_name                       | tcg_cards.set_name                     | text       | Same                                                                     |
| set_code             | set_code → card_id prefix      | tcg_cards.set_code / id                | text       | `id = lower(set_code-card_number)`; can collide (`A-1`/`2` vs `A`/`1-2`) |
| card_number          | card_number → card_id suffix   | tcg_cards.card_number                  | text       | Same                                                                     |
| condition            | condition_code (name → code)   | tcg_pricing.condition_code             | text FK    | Same                                                                     |
| reference_market_low | reference_cents                | tcg_pricing.reference_cents            | bigint ≥ 0 | Same                                                                     |
| source_name          | source_name                    | tcg_pricing.source_name                | text       | Same                                                                     |
| source_updated_at    | source_updated_at (YYYY-MM-DD) | tcg_pricing.source_updated_at          | date       | Same-date correction fails (F-08)                                        |
| — (from config)      | `p_client_id = "default"`      | tcg_pricing.client_id FK → tcg_clients | text       | **`default` row missing in DB** — FK would fail                          |

## F. Security findings

See F-01, F-04, F-05, F-11 in section C. Additional checks that passed:

- RLS is enabled on all 13 public tables, with select-only policies. Direct anon writes are blocked even though anon holds Supabase default table grants.
- No service-role key or provider key appears in served bundles. The publishable Supabase key is public by design.
- OCR, AI, and provider text is rendered with `textContent` throughout (`app.js`, `scanner-ui.js`, `admin.js`). No `innerHTML` sinks were found.
- CSP `frame-ancestors 'self'` and `Permissions-Policy camera=(self)`: the scanner cannot be embedded in another site (e.g. Nino's Collectibles) by iframe. Visitors must open the calculator's own origin.
- `/api/catalog-status` returns 401 without the admin bearer token.

Remediation acceptance:

- **F-01:** `has_function_privilege('anon', …)` and `has_function_privilege('authenticated', …)` both return false. The anon RPC returns 401/404. The service-role sync can still call it.
- **F-04:** the Vercel env `updatedAt` is later than `createdAt`, a production search succeeds with the new key, and the old key is revoked in the JustTCG dashboard (owner evidence).
- **F-05:** a server-side quota guard or per-IP limit exists, and a cross-site request on a cache HIT returns 403 (for example via a `Vary` on `Sec-Fetch-Site`, or by requiring a same-origin header).

## G. Production truth report

| Item                         | Value                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Vercel project               | `tcg-buy-calculator` / `prj_wUu0fqAzSagK7EZTOCmC9a5kdgKU`                                        |
| Domain                       | `tcg-buy-calculator.vercel.app` (no custom domain)                                               |
| Serving deployment           | `dpl_6hCBGWKNn4gVJ6uuiM2bHpM1yvk1`, commit `bd3446f`, READY 2026-10-10T20:11Z                    |
| Latest production deployment | `dpl_6YSVztGQNCuGgg2tLjKSJnR1WZPj`, commit `aede41c`, READY 2026-10-10T23:15Z, **not aliased**   |
| Env var names                | `JUSTTCG_API_KEY` only (sensitive). No `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`. |
| `/api/cards`                 | 200, `source: provider`, live JustTCG; `s-maxage=300` at the CDN                                 |
| `/api/games`                 | 200, 20 provider games                                                                           |
| `/api/identify`              | 404 (not in the served build)                                                                    |
| Supabase                     | `agscctnjusfqcpisirsq`, 3 migrations applied (repo has 7); 0 auth users                          |
| Open PRs                     | None                                                                                             |

## H. Regression and do-not-redo ledger

| Item                         | Previously reported | Current observed                                                                                              | Remediation needed       |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Printing-specific separation | Done                | **Holds** (live `4/102`, `OP05-119`)                                                                          | No                       |
| Pricing freshness rules      | Done                | Holds in code (7 days, undated refused); F-12 minor                                                           | No (P3)                  |
| CSP + camera fixes           | Done                | CSP served; camera allowed for self                                                                           | No                       |
| Default game selection       | Done                | Pokémon default in the served build                                                                           | No                       |
| Production promotion         | Done                | **Regressed:** domain pinned to PR #7; later merges never went live                                           | **Yes (F-02)**           |
| Vercel env setup             | Done                | `JUSTTCG_API_KEY` present                                                                                     | No                       |
| Real-phone camera validation | Open                | Still open                                                                                                    | Yes                      |
| Admin access + publishing    | Open                | **Worse than reported:** function missing, migrations missing, no users, wrong client id, unused by customers | Product decision (F-03)  |
| API-key rotation             | Open                | Still open; no evidence of rotation                                                                           | Yes (F-04)               |
| CSV ↔ table mismatch        | Open                | Confirmed: `default` client missing, RPC missing, same-date unique conflict                                   | Depends on F-03 decision |

## I. Prioritized remediation plan

| #   | Pri | Problem                          | Minimal fix                                                                                                                                   | Regression test / acceptance                                                                         | Safe without production change?            |
| --- | --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | P1  | F-01 anon-executable definer RPC | `revoke execute on function public.tcg_catalog_publish_prices(jsonb) from anon, authenticated;` plus a repo migration with the same statement | Privilege query false for both roles; anon RPC rejected; service role still works                    | No — DB change; needs Nick's authorization |
| 2   | P1  | F-02 stale production            | Promote `dpl_6YSVztGQNCuGgg2tLjKSJnR1WZPj`; re-enable production auto-assignment                                                              | Served `/index.html` and `/app.js` byte-match `aede41c`; run `npm run test:smoke` against production | No — production promotion                  |
| 3   | P1  | F-04 unrotated key               | Rotate in the JustTCG dashboard; update the Vercel env; redeploy                                                                              | Env `updatedAt` changes; a live search works; the old key is revoked                                 | No — owner action                          |
| 4   | P2  | F-05 open proxy / quota          | Same-origin requirement that survives caching, plus a server-side daily budget                                                                | Unit test + live MISS/HIT sequence returns 403 cross-site                                            | Code yes; deploy no                        |
| 5   | P2  | F-06 failing sync                | Disable the schedule until the catalog is used, or confirm which key it uses                                                                  | No scheduled runs, or a green run                                                                    | Repo change yes                            |
| 6   | P2  | F-03 admin path                  | **Decision:** retire the CSV/admin path, or wire `tcg_pricing` into the customer calculator, apply missing migrations, create the admin user  | Depends on the decision                                                                              | No                                         |
| 7   | P2  | F-07 policy mismatch             | **Decision:** adopt condition-specific pricing in the policy and disclaimer, or force the NM reference                                        | Policy doc matches `/api/cards` behavior                                                             | Doc yes                                    |
| 8   | P2  | F-09 iOS resume                  | Check `readyState === "live"` before reusing the stream; restart on `ended`                                                                   | Phone test                                                                                           | Code yes                                   |

## J. Final acceptance checklist

- [ ] Production serves `main` HEAD — **Fail**
- [x] Offer arithmetic correct (engine) — Pass
- [x] Printing-specific prices; no substitution — Pass (live)
- [x] Stale/undated prices refused — Pass (code + mocked tests)
- [ ] Multi-card list live — **Fail** (not deployed)
- [ ] Real-phone camera — **Not Tested**
- [ ] OCR accuracy measured — **Not Started**
- [ ] Admin can publish — **Fail**
- [ ] Unauthorized pricing writes impossible — **Fail** (F-01)
- [ ] Exposed key rotated — **Fail / open**
- [ ] Card API not a public proxy — **Fail** (F-05)
- [x] No secrets in bundles or history (pattern scan) — Pass
- [x] RLS on all tables — Pass
- [ ] Performance measured — **Not Started**
- [ ] Nino's Collectibles integration path — **UNVERIFIED** (no reference in the repo; iframe embedding blocked by CSP)

## Audit footprint

About 5 uncached production searches (up to 4 JustTCG calls each) and 1 games call were spent on the 1,000/day quota. Two RPC calls were sent with empty input; no rows were touched.
