# TCGCSV External Authorization Workflow

## Current status

The calculator software is complete and Hard Hittin’s policy is approved. TCGCSV authorization remains **PENDING / UNCLEAR**. Production pricing activation is blocked until written authorization is received and recorded.

The GitHub integration cannot create issues in the external TCGCSV repository. This is an external permission limitation, not a calculator software failure. Do not treat it as authorization evidence.

## Official request channels

- [TCGCSV GitHub Issues](https://github.com/CptSpaceToaster/tcgcsv/issues)
- [TCGCSV Discord](https://discord.gg/bydv2BNV25)

Submit the request manually through one of those official channels. Do not infer authorization from technical access or from the absence of a response.

## Exact request template

**Title:**

`Request for commercial-use authorization for TCGCSV-derived pricing`

**Body:**

Hello. We are building a card-buying calculator for Hard Hittin Card Shop (`hard-hittin`) that would use TCGCSV’s documented server-side JSON endpoints as a market-reference source.

Before enabling production use, could you please confirm in writing:

1. Whether using TCGCSV data in a commercial application is permitted.
2. Whether serving derived market-reference pricing to calculator users is permitted.
3. Whether storing the retrieved data in a private Supabase database/cache is permitted.
4. Whether any attribution is required, and the exact wording or link to use.
5. Whether any additional restrictions apply to daily synchronization, caching, or redistribution.

The application would:

- fetch data server-side only;
- respect the documented daily sync cadence, request pacing, User-Agent, and request-volume limits;
- identify the value as a “TCGCSV market reference,” not as condition-specific pricing;
- apply Hard Hittin’s separate shop policy and 60% buy rate to calculate an estimated offer;
- display a final-offer disclaimer stating that physical inspection and shop policy may change the result.

We will not publish TCGCSV-derived production pricing until this authorization and any attribution requirements are clarified. Thank you.

## Acceptable evidence

Record the maintainer’s written response, the source URL, response or issue URL, date, maintainer identity, exact permission scope, private-cache permission, derived-pricing permission, attribution requirements, restrictions, and the original evidence text. Do not mark a status authorized without evidence that specifically covers the intended use.

After evidence is recorded, an authorized administrator may update the compliance record. The server-side production gate must then recalculate before sync preview becomes available.

## Status model

| Area                           | Allowed status                  | Current status |
| ------------------------------ | ------------------------------- | -------------- |
| Commercial use                 | AUTHORIZED, UNCLEAR, DENIED     | UNCLEAR        |
| Derived pricing                | AUTHORIZED, UNCLEAR, DENIED     | UNCLEAR        |
| Attribution                    | REQUIRED, NOT_REQUIRED, UNCLEAR | UNCLEAR        |
| Overall external authorization | AUTHORIZED, PENDING, DENIED     | PENDING        |

Production may proceed only when commercial use and derived pricing are `AUTHORIZED`, attribution is `REQUIRED` with implemented requirements or `NOT_REQUIRED`, and the remaining technical gates pass.

The authenticated admin page reads the client, condition-policy, and compliance records from Supabase when it opens. It does not allow browser values, local storage, query parameters, or static labels to set production readiness.
