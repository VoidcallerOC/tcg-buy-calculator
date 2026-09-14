# TCGCSV source notes

Verified from https://tcgcsv.com/docs on 2026-09-14.

TCGCSV documents a daily-updated server-side JSON source. It says to check `https://tcgcsv.com/last-updated.txt` before syncing, sync no more than once per 24 hours, use a descriptive User-Agent, include at least 100ms between requests, and keep full syncs under 10,000 requests. It warns that browser CORS is restrictive and data should be pulled server-side into a local database/cache.

Documented endpoint paths:

- `https://tcgcsv.com/tcgplayer/categories`
- `https://tcgcsv.com/tcgplayer/{categoryId}/groups`
- `https://tcgcsv.com/tcgplayer/{categoryId}/{groupId}/products`
- `https://tcgcsv.com/tcgplayer/{categoryId}/{groupId}/prices`

Responses generally contain `success`, `errors`, and `results`; products contain `productId`, name, category/group IDs, modified time, and extended data such as card number; prices are one-to-many by product and variation and include `marketPrice`, low/mid/high, direct-low, and `subTypeName`. Prices are USD. TCGCSV documentation explicitly notes that `marketPrice` does not guarantee a condition and can reflect whatever condition has recent sales. Therefore the application must not label an unmapped `subTypeName` as Near Mint/LP/etc.; the provider uses an explicit variation-to-condition mapping and rejects unknown variations.

The source documentation links the underlying data to TCGplayer API exports but is treated here as TCGCSV data, not as a direct TCGplayer API integration.
