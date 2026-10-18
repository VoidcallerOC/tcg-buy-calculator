# Shop Intake Export

Export the customer’s in-visit card list (“Cards in this visit”) as JSON so the shop can archive or hand off an intake / sell-list transaction without changing pricing, scanning, the 60% buy rate, or inventory sync.

## What it exports

The payload is a snapshot of whatever the calculator already showed and stored in memory for this page load:

- Each list entry’s label, condition, offer cents, market reference cents, source timestamp, and (when unpriced) the unavailable reason
- A summary with card counts and totals from `lib/offer-list.js` `summarize` (unpriced cards are listed but not totalled)
- Client metadata from `data/config.json` (`client_id`, business name, currency, buy rate string)
- Schema id `tcg-buy-calculator.shop-intake.v1` and an `exportedAt` ISO timestamp

It does **not** recalculate offers, call pricing providers, or write to Supabase / inventory.

## Customer UI

On the visit list section:

- **Download JSON** — saves `shop-intake-<timestamp>.json`
- **Copy JSON** — writes the same document to the clipboard

Both actions require at least one card on the list. An empty list leaves the controls disabled (or reports a clear message if invoked). Clipboard permission denial or a missing Clipboard API reports a polite failure via the list note; the download path remains available.

## Module API

Pure helpers live in `lib/shop-intake-export.js`:

| Function                                               | Role                                            |
| ------------------------------------------------------ | ----------------------------------------------- |
| `canExportList(list)`                                  | Gate: empty / invalid vs exportable             |
| `buildShopIntakePayload({ list, client, exportedAt })` | Build the JSON object (throws on empty/invalid) |
| `formatShopIntakeJson(payload)`                        | Pretty-printed JSON string                      |
| `shopIntakeFilename(exportedAt)`                       | Filesystem-safe `.json` name                    |
| `copyTextToClipboard(text, deps?)`                     | Clipboard write with graceful `{ ok, reason }`  |
| `triggerJsonDownload(text, filename, deps?)`           | Browser download via object URL                 |

Unit tests: `lib/shop-intake-export.test.js`.

## Schema (v1)

```json
{
  "schema": "tcg-buy-calculator.shop-intake.v1",
  "exportedAt": "2026-10-17T12:00:00.000Z",
  "client": {
    "clientId": "default",
    "businessName": "TCG Buy Calculator",
    "currency": "USD",
    "buyRate": "60%"
  },
  "summary": {
    "count": 2,
    "priced": 1,
    "unpriced": 1,
    "offerCents": 600,
    "referenceCents": 1000
  },
  "items": [
    {
      "key": "card-1",
      "label": "Example · 001",
      "condition": "Near Mint",
      "offerCents": 600,
      "referenceCents": 1000,
      "effectiveBuyRateBasisPoints": 6000,
      "sourceUpdatedAt": "2026-10-10T00:00:00.000Z",
      "unavailable": null
    }
  ]
}
```

Money fields are integer cents. `unavailable` is set only when the card was added without an online estimate.

## Effective buy rate (additive, still v1)

`client.buyRate` is the **base configured** rate (unchanged meaning). Raw cards whose market reference meets a configured `buy_rate_tiers` threshold (default: $1,000.00+ → 70%) are offered at a higher rate. Each item therefore carries `effectiveBuyRateBasisPoints` — the integer basis points actually used for that offer (`6000` = 60%), or `null` for unpriced entries. It is recorded from the calculation already shown, never recomputed on export.

Compatibility: the field is additive; the schema id stays `v1`, no existing field changed meaning, and consumers that ignore unknown keys are unaffected. Consumers that need the real rate per card should read the item field rather than `client.buyRate`. Graded/slab cards are not supported and are not tiered.
