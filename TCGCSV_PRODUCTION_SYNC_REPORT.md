# TCGCSV PRODUCTION SYNC REPORT

## Provider

TCGCSV documented JSON provider.

## Sync

No production pricing sync has been completed in this run. The source status function is deployed and the provider is implemented, but the full category ingest has not yet been executed and transactionally published to Supabase.

## Status

**YELLOW — PROVIDER READY, REAL SYNC PENDING**

The system must not be called live until a real TCGCSV synchronization completes and the customer calculator reads the resulting production pricing.

## Provider implementation

The server-side provider uses the documented endpoints:

- `/tcgplayer/categories`
- `/tcgplayer/{categoryId}/groups`
- `/tcgplayer/{categoryId}/{groupId}/products`
- `/tcgplayer/{categoryId}/{groupId}/prices`
- `/last-updated.txt`

It applies the documented User-Agent and request pacing, dynamically discovers categories and groups, preserves stable product IDs, joins one-to-many product variations to prices, rejects missing market prices, and reports failed categories without deleting prior valid data.

TCGCSV `marketPrice` is the selected reference field. The provider does not substitute low, mid, high, or direct-low values. Because TCGCSV documents that market price does not guarantee condition, a variation-to-condition mapping is required; unknown variations are unavailable rather than mislabeled.

## Category verification

| TCG                    | Category ID | Groups | Products | Prices | Current | Stale | Failed |
| ---------------------- | ----------: | -----: | -------: | -----: | ------: | ----: | -----: |
| No live sync completed |           — |      — |        — |      — |       — |     — |      — |

Live source discovery completed at 2026-09-14T22:11:57.617Z. TCGCSV returned 94 categories. Groups, products, prices, freshness, and failures remain unpopulated because the full transactional sync has not yet been run.

| Magic | 1 | — | — | — | — | — | DISCOVERED |
| YuGiOh | 2 | — | — | — | — | — | DISCOVERED |
| Pokemon | 3 | — | — | — | — | — | DISCOVERED |
| Axis & Allies | 4 | — | — | — | — | — | DISCOVERED |
| Boardgames | 5 | — | — | — | — | — | DISCOVERED |
| D & D Miniatures | 6 | — | — | — | — | — | DISCOVERED |
| Epic | 7 | — | — | — | — | — | DISCOVERED |
| Heroclix | 8 | — | — | — | — | — | DISCOVERED |
| Monsterpocalypse | 9 | — | — | — | — | — | DISCOVERED |
| Redakai | 10 | — | — | — | — | — | DISCOVERED |
| Star Wars Miniatures | 11 | — | — | — | — | — | DISCOVERED |
| World of Warcraft Miniatures | 12 | — | — | — | — | — | DISCOVERED |
| WoW | 13 | — | — | — | — | — | DISCOVERED |
| Supplies | 14 | — | — | — | — | — | DISCOVERED |
| Organizers & Stores | 15 | — | — | — | — | — | DISCOVERED |
| Cardfight Vanguard | 16 | — | — | — | — | — | DISCOVERED |
| Force of Will | 17 | — | — | — | — | — | DISCOVERED |
| Dice Masters | 18 | — | — | — | — | — | DISCOVERED |
| Future Card BuddyFight | 19 | — | — | — | — | — | DISCOVERED |
| Weiss Schwarz | 20 | — | — | — | — | — | DISCOVERED |
| My Little Pony | 21 | — | — | — | — | — | DISCOVERED |
| TCGplayer | 22 | — | — | — | — | — | DISCOVERED |
| Dragon Ball Z TCG | 23 | — | — | — | — | — | DISCOVERED |
| Final Fantasy TCG | 24 | — | — | — | — | — | DISCOVERED |
| UniVersus | 25 | — | — | — | — | — | DISCOVERED |
| Star Wars Destiny | 26 | — | — | — | — | — | DISCOVERED |
| Dragon Ball Super CCG | 27 | — | — | — | — | — | DISCOVERED |
| Dragoborne | 28 | — | — | — | — | — | DISCOVERED |
| Funko | 29 | — | — | — | — | — | DISCOVERED |
| MetaX TCG | 30 | — | — | — | — | — | DISCOVERED |
| Card Sleeves | 31 | — | — | — | — | — | DISCOVERED |
| Deck Boxes | 32 | — | — | — | — | — | DISCOVERED |
| Card Storage Tins | 33 | — | — | — | — | — | DISCOVERED |
| Life Counters | 34 | — | — | — | — | — | DISCOVERED |
| Playmats | 35 | — | — | — | — | — | DISCOVERED |
| Zombie World Order TCG | 36 | — | — | — | — | — | DISCOVERED |
| The Caster Chronicles | 37 | — | — | — | — | — | DISCOVERED |
| My Little Pony CCG | 38 | — | — | — | — | — | DISCOVERED |
| Warhammer Books | 39 | — | — | — | — | — | DISCOVERED |
| Warhammer Big Box Games | 40 | — | — | — | — | — | DISCOVERED |
| Warhammer Box Sets | 41 | — | — | — | — | — | DISCOVERED |
| Warhammer Clampacks | 42 | — | — | — | — | — | DISCOVERED |
| Citadel Paints | 43 | — | — | — | — | — | DISCOVERED |
| Citadel Tools | 44 | — | — | — | — | — | DISCOVERED |
| Warhammer Game Accessories | 45 | — | — | — | — | — | DISCOVERED |
| Books | 46 | — | — | — | — | — | DISCOVERED |
| Exodus TCG | 47 | — | — | — | — | — | DISCOVERED |
| Lightseekers TCG | 48 | — | — | — | — | — | DISCOVERED |
| Protective Pages | 49 | — | — | — | — | — | DISCOVERED |
| Storage Albums | 50 | — | — | — | — | — | DISCOVERED |
| Collectible Storage | 51 | — | — | — | — | — | DISCOVERED |
| Supply Bundles | 52 | — | — | — | — | — | DISCOVERED |
| Munchkin CCG | 53 | — | — | — | — | — | DISCOVERED |
| Warhammer Age of Sigmar Champions TCG | 54 | — | — | — | — | — | DISCOVERED |
| Architect TCG | 55 | — | — | — | — | — | DISCOVERED |
| Bulk Lots | 56 | — | — | — | — | — | DISCOVERED |
| Transformers TCG | 57 | — | — | — | — | — | DISCOVERED |
| Bakugan TCG | 58 | — | — | — | — | — | DISCOVERED |
| KeyForge | 59 | — | — | — | — | — | DISCOVERED |
| Chrono Clash System | 60 | — | — | — | — | — | DISCOVERED |
| Argent Saga TCG | 61 | — | — | — | — | — | DISCOVERED |
| Flesh & Blood TCG | 62 | — | — | — | — | — | DISCOVERED |
| Digimon Card Game | 63 | — | — | — | — | — | DISCOVERED |
| Alternate Souls | 64 | — | — | — | — | — | DISCOVERED |
| Gate Ruler | 65 | — | — | — | — | — | DISCOVERED |
| MetaZoo | 66 | — | — | — | — | — | DISCOVERED |
| WIXOSS | 67 | — | — | — | — | — | DISCOVERED |
| One Piece Card Game | 68 | — | — | — | — | — | DISCOVERED |
| Marvel Comics | 69 | — | — | — | — | — | DISCOVERED |
| DC Comics | 70 | — | — | — | — | — | DISCOVERED |
| Lorcana TCG | 71 | — | — | — | — | — | DISCOVERED |
| Battle Spirits Saga | 72 | — | — | — | — | — | DISCOVERED |
| Shadowverse Evolve | 73 | — | — | — | — | — | DISCOVERED |
| Grand Archive | 74 | — | — | — | — | — | DISCOVERED |
| Akora | 75 | — | — | — | — | — | DISCOVERED |
| Kryptik TCG | 76 | — | — | — | — | — | DISCOVERED |
| Sorcery Contested Realm | 77 | — | — | — | — | — | DISCOVERED |
| Alpha Clash | 78 | — | — | — | — | — | DISCOVERED |
| Star Wars Unlimited | 79 | — | — | — | — | — | DISCOVERED |
| Dragon Ball Super Fusion World | 80 | — | — | — | — | — | DISCOVERED |
| Union Arena | 81 | — | — | — | — | — | DISCOVERED |
| TCGplayer Supplies | 82 | — | — | — | — | — | DISCOVERED |
| Elestrals | 83 | — | — | — | — | — | DISCOVERED |
| Neopets Battledome | 84 | — | — | — | — | — | DISCOVERED |
| Pokemon Japan | 85 | — | — | — | — | — | DISCOVERED |
| Gundam Card Game | 86 | — | — | — | — | — | DISCOVERED |
| hololive OFFICIAL CARD GAME | 87 | — | — | — | — | — | DISCOVERED |
| Godzilla Card Game | 88 | — | — | — | — | — | DISCOVERED |
| Riftbound League of Legends Trading Card Game | 89 | — | — | — | — | — | DISCOVERED |
| CookieRun Braverse TCG | 90 | — | — | — | — | — | DISCOVERED |
| Palworld OFFICIAL CARD GAME | 91 | — | — | — | — | — | DISCOVERED |
| Cyberpunk TCG | 92 | — | — | — | — | — | DISCOVERED |
| Naruto Card Game | 93 | — | — | — | — | — | DISCOVERED |
| Rush of Ikorr | 94 | — | — | — | — | — | DISCOVERED |

## Tests

- `npm test`: pending final run after TCGCSV provider addition.
- `npm run test:browser`: existing sample-mode browser coverage remains required.
- TCGCSV provider tests include documented path usage, User-Agent handling, product-to-group price joining, source freshness, and explicit variation mapping.

## Production

The customer remains in explicit sample mode until a validated production import exists. No sample data is used as a production fallback.

## Security

TCGCSV is fetched server-side only. The customer browser does not call TCGCSV directly. Existing Supabase RLS, authenticated admin authorization, transactional publishing, duplicate protection, and pricing history remain in place.

## Exact next action

Run the server-side TCGCSV sync preview, review the category-by-category report and unmapped-variation rejections, then publish only the validated result through the existing transactional Supabase import path.
